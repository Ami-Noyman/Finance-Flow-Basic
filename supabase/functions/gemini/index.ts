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

    // V16 ULTIMATE MAPPING: Exhaustive model discovery
    const results: any = {
      listResults: null,
      probes: {}
    }

    // 1. Get ALL models with their supported methods
    try {
        const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
        const listData = await listResp.json()
        results.listResults = listData.models || []
        
        // 2. Select the top candidates from the list
        const candidates = (listData.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
            .map((m: any) => m.name.split("/").pop())
            .slice(0, 5) // Test top 5

        const testPrompt = { contents: [{ role: 'user', parts: [{ text: "ping" }] }] }

        for (const modelId of candidates) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testPrompt)
                })
                const data = await resp.json()
                results.probes[modelId] = { status: resp.status, ok: resp.ok }
                if (resp.ok) {
                    results.successModel = modelId
                    results.successData = data
                    break; // stop at first success
                }
            } catch (e: any) {
                results.probes[modelId] = { error: e.message }
            }
        }
    } catch (e: any) {
        results.listError = e.message
    }

    return new Response(
      JSON.stringify({ 
        text: results.successData?.candidates?.[0]?.content?.parts?.[0]?.text || "MAPPING_COMPLETE", 
        deploy: "V16", 
        mapping: results 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V16 Error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V16" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
