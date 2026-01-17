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

    const { prompt, contents, systemInstruction, generationConfig } = await req.json()

    if (!prompt && !contents) {
      throw new Error("Missing prompt or contents in request body")
    }

    // Initialize the SDK
    const genAI = new GoogleGenerativeAI(apiKey)
    
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction,
      generationConfig: generationConfig
    })

    console.log(`[Edge Function] Calling Gemini model: gemini-1.5-flash`);

    // Handle either a single prompt string or a contents array (history)
    const result = await model.generateContent(contents || prompt)
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
    
    // Return a structured error so the client can show helpful info
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
