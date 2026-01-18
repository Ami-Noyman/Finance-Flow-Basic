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

    // V18.0 STABLE: Use gemini-1.5-flash as primary for better free-tier quotas
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: systemInstruction || "You are a financial categorization assistant. Given a transaction payee/description, amount, and existing categories, return ONLY the most likely category name. If unsure, return 'General' or 'כללי'." 
    })

    // If contents is provided, use it. Otherwise use prompt.
    const result = await model.generateContent({
        contents: contents || [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: generationConfig
    })
    
    const text = result.response.text().trim().replace(/['"`]/g, '')

    return new Response(
      JSON.stringify({ 
        text, 
        deploy: "V18.0",
        model: "gemini-1.5-flash"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: any) {
    console.error("[Edge Function] V18 Error:", error.message)
    
    // Explicit 429 error return
    if (error.message.includes("429") || error.message.includes("quota") || error.message.includes("limit")) {
        return new Response(
            JSON.stringify({ 
                error: "Google AI Quota Exceeded. The free tier allows 15 requests per minute and 1,500 per day. Please try again in 1 minute.", 
                isAIFailure: true, 
                deploy: "V18-Quota" 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }

    // Generic Fallback attempt
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const result = await model.generateContent(prompt)
        return new Response(
            JSON.stringify({ text: result.response.text().trim(), deploy: "V18-Fallback" }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (e) {
        return new Response(
            JSON.stringify({ error: error.message, isAIFailure: true, deploy: "V18-Error" }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }
  }
})
