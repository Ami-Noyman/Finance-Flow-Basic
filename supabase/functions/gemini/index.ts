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

    // V12 PRODUCTION: SDK with v1beta explicit version
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: generationConfig
    }, { apiVersion: 'v1beta' })

    console.log(`[Edge Function] [Deploy V12] Calling Gemini 1.5 Flash via v1beta SDK`);

    // Handle System Instructions for Chat compatibility
    let finalContents = contents || [{ role: 'user', parts: [{ text: prompt }] }];
    if (systemInstruction) {
      finalContents = [
        { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemInstruction}` }] },
        { role: 'model', parts: [{ text: "Understood." }] },
        ...finalContents
      ];
    }

    const result = await model.generateContent({ contents: finalContents })
    const response = await result.response
    const text = response.text()

    if (!text) throw new Error("AI returned an empty response.")

    return new Response(
      JSON.stringify({ text, deploy: "V12" }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V12 Final Error:", error.message)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack,
        isAIFailure: true,
        deploy: "V12"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})
