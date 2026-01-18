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

    // V19.0 ROBUST: Multi-model fallback strategy
    const genAI = new GoogleGenerativeAI(apiKey)
    
    const tryModel = async (modelName: string, apiVer?: string) => {
        console.log(`[Edge Function] Attempting model: ${modelName} (${apiVer || 'default'})`)
        const model = genAI.getGenerativeModel({ 
            model: modelName,
            systemInstruction: systemInstruction || "You are a financial categorization assistant. Given a transaction payee/description, amount, and existing categories, return ONLY the most likely category name. If unsure, return 'General' or 'כללי'." 
        }, { apiVersion: apiVer })

        return await model.generateContent({
            contents: contents || [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: generationConfig
        })
    }

    let result;
    let activeModel = "gemini-1.5-flash";
    
    try {
        // Try 1: 1.5 Flash on V1 (Stable)
        result = await tryModel("gemini-1.5-flash", "v1")
    } catch (err1: any) {
        console.warn("[Edge Function] 1.5-flash V1 failed:", err1.message)
        try {
            // Try 2: 2.0 Flash (Experimental)
            activeModel = "gemini-2.0-flash"
            result = await tryModel("gemini-2.0-flash")
        } catch (err2: any) {
            console.warn("[Edge Function] 2.0-flash failed:", err2.message)
            // Try 3: 1.5 Pro (High Quota Fallback)
            activeModel = "gemini-1.5-pro"
            result = await tryModel("gemini-1.5-pro", "v1")
        }
    }
    
    const text = result.response.text().trim().replace(/['"`]/g, '')

    return new Response(
      JSON.stringify({ 
        text, 
        deploy: "V19.0",
        model: activeModel
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] Final Error:", error.message)
    
    // Check if it's a quota issue across all models
    if (error.message.includes("429") || error.message.toLowerCase().includes("quota") || error.message.includes("RESOURCE_EXHAUSTED")) {
        return new Response(
            JSON.stringify({ 
                error: "All Gemini models are currently at their quota limit. This happens on free accounts after several requests. Please try again in about 1 minute.", 
                isAIFailure: true, 
                deploy: "V19-Quota" 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }

    return new Response(
        JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V19-Error" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
