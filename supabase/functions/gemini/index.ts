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

    // V14 DISCOVERY PROXY: Exhaustive testing with listModels output
    const results: any = {
      listModels: [],
      probes: {}
    }

    // 1. Get the real list of models again
    try {
        const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
        const listData = await listResp.json()
        results.listModels = listData.models || []
    } catch (e: any) {
        results.listModelsError = e.message
    }

    // 2. Probes with diverse configurations
    const probeConfigs = [
      { id: "v1beta-flash", url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent` },
      { id: "v1beta-flash-latest", url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent` },
      { id: "v1-flash", url: `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent` },
      { id: "v1-pro", url: `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent` }
    ]

    const probePayload = { contents: [{ role: 'user', parts: [{ text: "echo: probe" }] }] }

    for (const config of probeConfigs) {
      try {
        const urlWithKey = `${config.url}?key=${apiKey}`
        const resp = await fetch(urlWithKey, {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey // Try both query param and header
          },
          body: JSON.stringify(probePayload)
        })
        const data = await resp.json()
        results.probes[config.id] = { status: resp.status, body: data }
      } catch (e: any) {
        results.probes[config.id] = { error: e.message }
      }
    }

    return new Response(
      JSON.stringify({ 
        text: "DISCOVERY_PROBE_V14_COMPLETE", 
        deploy: "V14", 
        discovery: results 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V14 Error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V14" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
