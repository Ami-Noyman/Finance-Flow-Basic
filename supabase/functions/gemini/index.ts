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

  let apiKey = ''
  try {
    apiKey = Deno.env.get("GEMINI_API_KEY") || ''
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase Secrets")
    }

    const body = await req.json()
    console.log("[Edge Function] Request body:", JSON.stringify(body))
    
    const { prompt, contents, systemInstruction, generationConfig } = body

    if (!prompt && !contents) {
      throw new Error("Missing prompt or contents in request body")
    }

    // V17 FINAL PRODUCTION: Use Gemini 2.0 Flash
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction: "You are a financial categorization assistant. Given a transaction payee/description, amount, and existing categories, return ONLY the most likely category name. If unsure, return 'General' or 'כללי'." 
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim().replace(/['"`]/g, '')

    return new Response(
      JSON.stringify({ 
        text, 
        deploy: "V17",
        model: "gemini-2.0-flash"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V17 Error:", error.message)
    
    // Fallback attempt if 2.0 fails unexpectedly
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const result = await model.generateContent(prompt)
        return new Response(
            JSON.stringify({ text: result.response.text().trim(), deploy: "V17-Fallback" }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (e) {
        return new Response(
            JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V17-Error" }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }
  }
})
