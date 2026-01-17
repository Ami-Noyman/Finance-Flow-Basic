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

    // V15 PROTOCOL DEEP DIVE: Isolate Auth Methods & API Versions
    const results: any = {
      probes: {}
    }

    const testPrompt = { contents: [{ role: 'user', parts: [{ text: "ping" }] }] }

    // Variant 1: Query Param ONLY (Standard for many examples)
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPrompt)
      })
      results.probes["query-v1beta-flash"] = { status: resp.status, body: await resp.json() }
    } catch (e: any) { results.probes["query-v1beta-flash"] = { error: e.message } }

    // Variant 2: Header x-goog-api-key ONLY
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(testPrompt)
      })
      results.probes["header-v1beta-flash"] = { status: resp.status, body: await resp.json() }
    } catch (e: any) { results.probes["header-v1beta-flash"] = { error: e.message } }

    // Variant 3: Stable v1 + Query Param
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPrompt)
      })
      results.probes["query-v1-flash"] = { status: resp.status, body: await resp.json() }
    } catch (e: any) { results.probes["query-v1-flash"] = { error: e.message } }

    // Variant 4: Try 8b-flash (sometimes available when flash isn't)
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPrompt)
      })
      results.probes["query-v1beta-8b"] = { status: resp.status, body: await resp.json() }
    } catch (e: any) { results.probes["query-v1beta-8b"] = { error: e.message } }

    return new Response(
      JSON.stringify({ 
        text: "PROTOCOL_DEEP_DIVE_V15_COMPLETE", 
        deploy: "V15", 
        results: results 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V15 Error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V15" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
