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

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY")
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase Secrets")
    }

    const body = await req.json()
    console.log("[Edge Function] Request body:", JSON.stringify(body))
    
    const { prompt, contents, systemInstruction, generationConfig } = body

    if (!prompt && !contents) {
      throw new Error("Missing prompt or contents in request body")
    }

    // V10 DIAGNOSTIC FAILOVER: Try multiple models until one works
    const modelsToTry = [
      { name: "gemini-1.5-flash", apiVersion: "v1" },
      { name: "gemini-1.5-flash-latest", apiVersion: "v1beta" },
      { name: "gemini-1.5-pro", apiVersion: "v1" },
      { name: "gemini-pro", apiVersion: "v1" } // 1.0 Pro
    ]

    let result = null
    let workingModel = ""
    let lastError = ""

    for (const modelConfig of modelsToTry) {
      try {
        console.log(`[V10] Attempting: ${modelConfig.name} (${modelConfig.apiVersion})`)
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ 
          model: modelConfig.name,
          generationConfig: generationConfig
        }, { apiVersion: modelConfig.apiVersion as any })

        // Prepare contents
        let finalContents = contents || [{ role: 'user', parts: [{ text: prompt }] }];
        if (systemInstruction) {
          finalContents = [
            { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemInstruction}` }] },
            { role: 'model', parts: [{ text: "Understood." }] },
            ...finalContents
          ];
        }

        const genResult = await model.generateContent({ contents: finalContents })
        const response = await genResult.response
        const text = response.text()
        
        result = text
        workingModel = `${modelConfig.name} (${modelConfig.apiVersion})`
        console.log(`[V10] SUCCESS with ${workingModel}`)
        break 
      } catch (e: any) {
        console.error(`[V10] FAILED ${modelConfig.name}:`, e.message)
        lastError = e.message
        continue
      }
    }

    if (!result) {
      throw new Error(`All models failed. Last error: ${lastError}. Models tried: ${modelsToTry.map(m => m.name).join(', ')}`)
    }

    return new Response(
      JSON.stringify({ text: result, deploy: "V10", model: workingModel }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] Final Error:", error.message)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack,
        isAIFailure: true,
        deploy: "V10"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})
