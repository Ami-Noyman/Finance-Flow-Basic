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

    // Initialize the SDK
    const genAI = new GoogleGenerativeAI(apiKey)
    
    // Use the default stable API version (v1) which now supports systemInstructions
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction,
      generationConfig: generationConfig
    })

    console.log(`[Edge Function] Calling Gemini model: gemini-1.5-flash (stable)`);

    // CRITICAL: We MUST wrap the array in an object with a 'contents' field,
    // otherwise the SDK treats the array elements as 'Part' objects instead of 'Content' objects,
    // which causes the 'Unknown name "role"' error.
    const request = contents 
      ? { contents } 
      : { contents: [{ role: 'user', parts: [{ text: prompt }] }] }

    const result = await model.generateContent(request)
    const response = await result.response
    const text = response.text()

    return new Response(
      JSON.stringify({ text }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] Error:", error.message)
    
    // Return 200 with error data so Supabase Function client doesn't throw a generic exception
    // and we can see the real error message in the client console.
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack,
        isAIFailure: true
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})
