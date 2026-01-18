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

    // V20.0 COMPATIBILITY: Prepend instructions to avoid 400 "Unknown field systemInstruction" on v1 API
    const genAI = new GoogleGenerativeAI(apiKey)
    
    // Default instruction
    const defaultInstruction = "You are a financial categorization assistant. Given a transaction payee/description, amount, and existing categories, return ONLY the most likely category name. If unsure, return 'General' or 'כללי'."
    const finalInstruction = systemInstruction || defaultInstruction

    const tryModel = async (modelName: string, apiVer?: string) => {
        console.log(`[Edge Function] Attempting model: ${modelName} (${apiVer || 'default'})`)
        const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: apiVer })

        // Prepend instruction for maximum compatibility across v1/v1beta
        const modifiedContents = contents ? [...contents] : [{ role: 'user', parts: [{ text: prompt }] }]
        if (modifiedContents[0]?.parts[0]) {
            const originalText = modifiedContents[0].parts[0].text || ""
            modifiedContents[0].parts[0].text = `Instructions: ${finalInstruction}\n\nTask: ${originalText}`
        }

        return await model.generateContent({
            contents: modifiedContents,
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
        deploy: "V20.0",
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
                error: "All Gemini models are reached their free quota limit. Please try again in 1-2 minutes.", 
                isAIFailure: true, 
                deploy: "V20-Quota",
                model: "multiple-fails"
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }

    return new Response(
        JSON.stringify({ 
            error: error.message, 
            isAIFailure: true, 
            deploy: "V20-Error",
            model: "multiple-fails"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
