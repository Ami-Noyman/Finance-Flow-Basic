import { GoogleGenAI } from "@google/genai";

// Usage: node test_gemini.js YOUR_API_KEY
const apiKey = process.argv[2];

if (!apiKey) {
    console.error("Please provide an API key: node test_gemini.js YOUR_API_KEY");
    process.exit(1);
}

async function runFinalTest() {
    console.log("--- TESTING LATEST ALIASES ---");
    const client = new GoogleGenAI({ apiKey });

    // These were found in your models.list output
    const modelsToTry = [
        "models/gemini-flash-latest",
        "models/gemini-pro-latest",
        "models/gemini-2.0-flash",
        "models/gemini-1.5-flash" // Verify if this really fails
    ];

    for (const modelId of modelsToTry) {
        try {
            console.log(`\n--- Testing: ${modelId} ---`);
            const result = await client.models.generateContent({
                model: modelId,
                contents: [{ role: 'user', parts: [{ text: "Are you working?" }] }]
            });
            console.log(`✅ SUCCESS! Response: ${result.text}`);
        } catch (err) {
            console.error(`❌ FAILED: ${err.message}`);
        }
    }
}

runFinalTest();
