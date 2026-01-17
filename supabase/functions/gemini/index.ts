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

    // V13 EXHAUSTIVE NAKED PROBE
    // We probe multiple variants to see which one works (if any) and WHY
    const results: any = {}
    
    const probes = [
      { id: "v1beta-flash", url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}` },
      { id: "v1beta-flash-8b", url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}` },
      { id: "v1-flash", url: `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}` },
      { id: "v1-pro", url: `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}` }
    ]

    const probePayload = {
      contents: [{ role: 'user', parts: [{ text: "echo: probe" }] }]
    }

    for (const p of probes) {
      try {
        console.log(`[V13] Probing ${p.id}...`)
        const resp = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(probePayload)
        })
        const data = await resp.json()
        results[p.id] = { status: resp.status, body: data }
        if (resp.status === 200) {
            console.log(`[V13] SUCCESS with ${p.id}`)
        } else {
            console.error(`[V13] FAILED ${p.id}: ${resp.status}`)
        }
      } catch (e: any) {
        results[p.id] = { error: e.message }
      }
    }

    return new Response(
      JSON.stringify({ 
        text: "EXHAUSTIVE_PROBE_COMPLETE", 
        deploy: "V13", 
        probes: results 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V13 Final Error:", error.message)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack,
        isAIFailure: true,
        deploy: "V13"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})
