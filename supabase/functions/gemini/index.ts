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

    // V11 DEEP DIAGNOSTIC: SDK-LESS PROBE
    const diagnosticResults: any = {
      detectedModels: [],
      rawFlashProbe: null,
      errorLog: []
    }

    try {
      console.log("[V11] Phase 1: Listing models via raw fetch...")
      const listResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      )
      const listData = await listResponse.json()
      diagnosticResults.detectedModels = listData.models?.map((m: any) => m.name) || []
      console.log(`[V11] Discovered ${diagnosticResults.detectedModels.length} models.`)
    } catch (e: any) {
      diagnosticResults.errorLog.push(`ListModels Failed: ${e.message}`)
    }

    try {
      console.log("[V11] Phase 2: Attempting RAW fetch to v1beta flash model...")
      const probePayload = {
        contents: [{ role: 'user', parts: [{ text: "echo: testing" }] }]
      }
      const flashResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(probePayload)
        }
      )
      const flashData = await flashResponse.json()
      diagnosticResults.rawFlashProbe = flashData
      console.log("[V11] Raw probe executed.")
    } catch (e: any) {
      diagnosticResults.errorLog.push(`Raw Flash Probe Failed: ${e.message}`)
    }

    // Now fallback to the best SDK attempt if we want to return actual text
    // BUT for V11 we want to surface the diagnostics primary.
    
    return new Response(
      JSON.stringify({ 
        text: "DIAGNOSTIC_MODE_ACTIVE", 
        deploy: "V11", 
        diagnostics: diagnosticResults 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V11 Final Error:", error.message)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack,
        isAIFailure: true,
        deploy: "V11"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})
