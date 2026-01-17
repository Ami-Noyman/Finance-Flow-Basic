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
    
    // STABLE VERSION: Explicitly force v1
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: generationConfig
    }, { apiVersion: 'v1' })

    console.log(`[Edge Function] [Deploy V8] Calling Gemini model: gemini-1.5-flash (v1)`);

    // FOR STABLE API COMPATIBILITY:
    // If systemInstruction is provided, we prepend it as a 'user' message 
    // since the v1 endpoint often rejects the 'systemInstruction' field in the JSON payload.
    let finalContents = contents || [{ role: 'user', parts: [{ text: prompt }] }];
    
    if (systemInstruction) {
      finalContents = [
        { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemInstruction}\n\nPlease follow the above instruction strictly for all subsequent messages.` }] },
        { role: 'model', parts: [{ text: "Understood. I will follow those instructions." }] },
        ...finalContents
      ];
    }

    const request = { contents: finalContents };

    const result = await model.generateContent(request)
    const response = await result.response
    const text = response.text()

    return new Response(
      JSON.stringify({ text, deploy: "V8" }),
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
