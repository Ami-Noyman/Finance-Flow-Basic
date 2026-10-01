import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log("[Edge Function] Handling OPTIONS preflight")
    return new Response('ok', { headers: corsHeaders })
  }

  let apiKey = ''
  try {
    apiKey = Deno.env.get("GEMINI_API_KEY") || ''
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase Secrets")
    }

    const body = await req.json()
    console.log("[Edge Function] Request body:", JSON.stringify(body))
    
    if (body.listModels) {
      console.log("[Edge Function] Fetching available models list from Google API...")
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      const data = await res.json()
      return new Response(
        JSON.stringify(data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const { prompt, contents, systemInstruction, generationConfig } = body

    if (!prompt && !contents) {
      throw new Error("Missing prompt or contents in request body")
    }

    // V24.0: Dynamic fallback with 503 exponential backoff
    const genAI = new GoogleGenerativeAI(apiKey)
    
    const defaultModels = [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-3.8-flash",
        "gemini-2.5-flash-lite",
        "gemini-pro-latest"
    ]
    const modelsToTry = body.model 
        ? [body.model, ...defaultModels.filter(m => m !== body.model)]
        : defaultModels

    let lastError = ""
    let activeModel = "none"
    let quotaReached = false

    for (const modelName of modelsToTry) {
        if (quotaReached) break

        // Allow up to 2 retries on 503 Service Unavailable (high demand)
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                console.log(`[Edge Function] V24 Testing: ${modelName} (attempt ${attempt})`)
                activeModel = modelName
                const model = genAI.getGenerativeModel({ 
                    model: modelName,
                    systemInstruction: systemInstruction || "You are a financial assistant."
                }, { apiVersion: "v1beta" })

                const result = await model.generateContent({
                    contents: contents || [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: generationConfig
                })
                
                const text = result.response.text().trim()
                return new Response(
                    JSON.stringify({ text, deploy: "V24.0", model: activeModel }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
                )
            } catch (err: any) {
                const errMsg = err.message || JSON.stringify(err)
                console.warn(`[Edge Function] ${modelName} attempt ${attempt} failed:`, errMsg)

                // If 503 high demand, pause and retry
                if (errMsg.includes("503") || errMsg.includes("high demand") || errMsg.includes("Service Unavailable")) {
                    if (attempt < 2) {
                        console.log(`[Edge Function] Waiting 1.5s before retry for ${modelName}...`)
                        await new Promise(r => setTimeout(r, 1500))
                        continue
                    }
                }

                lastError += `[${modelName}: ${errMsg}] `
                
                // If it's a quota error or rate limit, stop iterating to save time/quota
                if (errMsg.includes("429") || errMsg.toLowerCase().includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
                    quotaReached = true
                    break
                }

                // If it's a safety error, don't keep trying others
                if (errMsg.includes("SAFETY")) {
                    throw new Error(`Safety Filter: ${errMsg}`)
                }

                // For 404 or other errors, break retry loop and try next model
                break
            }
        }
    }

    // If we get here, everything failed
    if (quotaReached) {
        throw new Error("Google AI Quota reached. The free tier is exhausted. Please wait or try a new API key.")
    }
    throw new Error(`Service Unavailable. Errors: ${lastError}`)

  } catch (error: any) {
    console.error("[Edge Function] Final Crash:", error.message)
    
    let userMsg = error.message
    let deployLabel = "V24-Fail"
    
    if (userMsg.toLowerCase().includes("quota") || userMsg.includes("429") || userMsg.includes("RESOURCE_EXHAUSTED")) {
        userMsg = "Google AI Quota reached for all models (1.5, 2.0, Pro). The free tier is currently exhausted on your account. Please wait a few hours or until tomorrow. שגיאת תקשורת: מכסת השימוש בבינה המלאכותית הסתיימה להיום. יש להמתין מספר שעות או עד מחר."
        deployLabel = "V24-Quota"
    }

    return new Response(
        JSON.stringify({ 
            error: userMsg, 
            isAIFailure: true, 
            deploy: deployLabel,
            model: "info" 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
