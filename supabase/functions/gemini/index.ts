import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
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
    
    const { prompt, contents, systemInstruction, generationConfig } = body

    if (!prompt && !contents) {
      throw new Error("Missing prompt or contents in request body")
    }

    // V22.0 DIAGNOSTIC: Try everything to find a model that isn't 404 or Quota limit 0
    const genAI = new GoogleGenerativeAI(apiKey)
    
    const modelsToTry = [
        "gemini-1.5-flash",
        "gemini-2.0-flash", // Re-trying 2.0 in case quota reset
        "gemini-1.5-pro",
        "gemini-1.5-flash-8b", // Smaller, often separate quota
        "gemini-1.0-pro" // Legacy
    ]

    let lastError = ""
    let activeModel = "none"

    for (const modelName of modelsToTry) {
        try {
            console.log(`[Edge Function] V22 Testing: ${modelName}`)
            activeModel = modelName
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                systemInstruction: systemInstruction || "You are a financial assistant."
            }, { apiVersion: "v1beta" })

            const result = await model.generateContent({
                contents: contents || [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: generationConfig
            })
            
            const text = result.response.text().trim().replace(/['"`]/g, '')
            return new Response(
                JSON.stringify({ text, deploy: "V22.0", model: activeModel }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
        } catch (err: any) {
            console.warn(`[Edge Function] ${modelName} failed:`, err.message)
            lastError += `[${modelName}: ${err.message}] `
            
            // If it's a safety error, don't keep trying others, just report it
            if (err.message.includes("SAFETY")) {
                throw new Error(`Safety Filter: ${err.message}`)
            }
        }
    }

    // If we get here, everything failed
    throw new Error(`Diagnostic Failure. Tested 5 models: ${lastError}`)

  } catch (error: any) {
    console.error("[Edge Function] Final Crash:", error.message)
    
    let userMsg = error.message
    let deployLabel = "V22-Error"
    
    if (userMsg.includes("429") || userMsg.toLowerCase().includes("quota") || userMsg.includes("RESOURCE_EXHAUSTED")) {
        userMsg = "Google AI Quota reached for all models (1.5, 2.0, Pro). The free tier is currently exhausted on your account. Please wait a few hours or until tomorrow."
        deployLabel = "V22-Quota"
    }

    return new Response(
        JSON.stringify({ 
            error: userMsg, 
            isAIFailure: true, 
            deploy: deployLabel,
            model: "all-failed" 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
