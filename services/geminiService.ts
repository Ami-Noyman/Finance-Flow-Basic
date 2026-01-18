import { Transaction, RecurringTransaction, ForecastPoint, Account, TransactionRule } from '../types';
import { initSupabase } from './supabaseClient';

/**
 * Robust helper to check if the AI service is available via Supabase.
 */
export const hasValidApiKey = () => {
    // We now rely on the server-side key in Supabase. 
    // We just check if Supabase is initialized.
    const supabase = initSupabase();
    return !!supabase;
};

export const getApiKey = () => "HIDDEN_IN_SUPABASE";

const QUOTA_COOLDOWN_MS = 60 * 1000; // 60 seconds
let lastQuotaErrorTime = 0;

const invokeGemini = async (contents: any[], systemInstruction?: string, responseSchema?: any) => {
    // CIRCUIT BREAKER: Avoid calling AI if we are in a cooldown period
    const now = Date.now();
    if (now - lastQuotaErrorTime < QUOTA_COOLDOWN_MS) {
        const remaining = Math.ceil((QUOTA_COOLDOWN_MS - (now - lastQuotaErrorTime)) / 1000);
        console.warn(`[AI Service] Circuit Breaker Active. Cooldown: ${remaining}s`);
        throw new Error("Quota exceeded (Cooldown Active). Please wait before trying again.");
    }

    const supabase = initSupabase();
    if (!supabase) throw new Error("Supabase client failed to initialize.");

    // Ensure role is present for all content items (Gemini SDK requirement)
    const sanitizedContents = contents.map(c => ({
        role: c.role || 'user',
        parts: c.parts
    }));

    try {
        const { data, error } = await supabase.functions.invoke('gemini', {
            body: { 
                contents: sanitizedContents, 
                systemInstruction,
                generationConfig: responseSchema ? {
                    response_mime_type: "application/json",
                    response_schema: responseSchema
                } : undefined
            }
        });

        if (error) {
            console.error("[AI Service] Supabase Function Error:", error);
            throw new Error(`Edge Function Error: ${error.message || JSON.stringify(error)}`);
        }

        if (data?.deploy) {
            console.log(`[AI Service] Edge Function Version: ${data.deploy} (${data.model || 'gemini-1.5-flash'})`);
        }

        // Check for server-side AI failure (we returned it with 200 to bypass generic error swallow)
        if (data?.isAIFailure) {
            const errorMsg = data.error || "Unknown AI error";
            console.error("[AI Service] Server-side AI Error:", errorMsg);
            
            // Set cooldown if it's a quota error
            if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
                lastQuotaErrorTime = Date.now();
            }
            throw new Error(errorMsg); // Throw the clean message from server
        }

        if (data?.error) {
            const errorMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
            console.error("[AI Service] Gemini API Error:", errorMsg);

            // Set cooldown if it's a quota error
            if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
                lastQuotaErrorTime = Date.now();
            }
            throw new Error(`Gemini Error: ${errorMsg}`);
        }


        // The Edge Function now returns { text } directly
        const text = data?.text;
        if (!text) {
            console.warn("[AI Service] Empty response from Edge Function. Data:", data);
            return "";
        }
        return text;
    } catch (e: any) {
        console.error("[AI Service] Invoke Exception:", e);
        
        // Also check exception message for quota
        const msg = e.message || "";
        if (msg.includes("429") || msg.includes("Quota") || msg.includes("RESOURCE_EXHAUSTED")) {
            lastQuotaErrorTime = Date.now();
        }
        throw e;
    }
};

/**
 * SMART CATEGORIZATION ENGINE
 * 1. Checks manual rules
 * 2. Checks historical transactions (Learning from DB)
 * 3. Calls Gemini AI only if payee is unknown
 */
export const categorizeTransaction = async (
  payee: string, 
  amount: number, 
  history: Transaction[], 
  rules: TransactionRule[],
  existingCategories: string[] = []
): Promise<string> => {
  const normalizedPayee = payee.toLowerCase().trim();

  // LAYER 1: Check Manual Rules
  const matchedRule = rules.find(r => r.isActive && normalizedPayee.includes(r.payeePattern.toLowerCase()));
  if (matchedRule) return matchedRule.category;

  // LAYER 2: Check History (Learn from Database)
  // Find the most frequent category used for this payee in the past
  const pastMatches = history.filter(t => (t.payee || "").toLowerCase().trim() === normalizedPayee);
  if (pastMatches.length > 0) {
    const counts: Record<string, number> = {};
    pastMatches.forEach(m => counts[m.category] = (counts[m.category] || 0) + 1);
    const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return topCategory;
  }

  // LAYER 3: Call AI (Only for brand new payees)
  try {
    if (!hasValidApiKey()) return "כללי";
    
    const categoriesList = existingCategories.length > 0 
      ? `בחר מהרשימה: [${existingCategories.join(', ')}]. אם אין התאמה, צור חדשה בעברית.` 
      : `קטלג למילה אחת בעברית.`;

    const result = await invokeGemini(
        [{ parts: [{ text: `קטלג הוצאה: "${payee}" (${amount} ש"ח). ${categoriesList}. החזר רק את שם הקטגוריה.` }] }]
    );
    
    return result.trim() || "כללי";
  } catch (error: any) {
    console.error("AI Categorization failed:", error);
    return "כללי"; 
  }
};

export const generateFinancialInsight = async (transactions: Transaction[], forecast: ForecastPoint[]): Promise<string> => {
  if (!hasValidApiKey()) throw new Error("API_KEY_MISSING");

  const recentTxsSummary = transactions.slice(0, 15).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');
  const forecastSummary = forecast.filter((_, i) => i % 20 === 0).map(f => `${f.date}: Balance ${Math.round(f.balance)}`).join('\n');

  const prompt = `נתח את הנתונים הפיננסיים הבאים וספק 2-3 תובנות או טיפים מותאמים אישית בעברית.\nתנועות אחרונות:\n${recentTxsSummary}\nתחזית יתרה עתידית:\n${forecastSummary}`;

  return await invokeGemini(
      [{ parts: [{ text: prompt }] }],
      "אתה יועץ פיננסי מקצועי המומחה בניהול תקציב ותזרים מזומנים. השב בעברית בלבד תוך שימוש בפורמט Markdown נקי וקריא."
  );
};

export const analyzeAnomalies = async (transactions: Transaction[]): Promise<string[]> => {
  try {
    if (!hasValidApiKey()) return [];

    const recent = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} - ${t.amount} (${t.category})`).join('\n');
    const result = await invokeGemini(
        [{ parts: [{ text: `מצא 2-3 חריגות פיננסיות בתנועות האלה. החזר מערך JSON של מחרוזות בעברית.\nתנועות:\n${recent}` }] }],
        undefined,
        {
          type: "array",
          items: { type: "string" }
        }
    );
    
    return JSON.parse(result || "[]");
  } catch (e: any) {
    console.error("AI Anomaly Analysis failed:", e);
    return [];
  }
};

export const createFinancialChatSession = (transactions: Transaction[], recurring: RecurringTransaction[], accounts: Account[]): any => {
    if (!hasValidApiKey()) throw new Error("API_KEY_MISSING");

    const accountSummary = accounts.map(a => `- ${a.name}: ${a.currency} ${a.initialBalance}`).join('\n');
    const recurringSummary = recurring.filter(r => r.isActive).map(r => `- ${r.payee}: ${r.amount}`).join('\n');
    const recentTx = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');

    const systemInstruction = `אתה בוט פיננסי עוזר עבור אפליקציית FinanceFlow. השב תמיד בעברית.\nקונטקסט:\nחשבונות:\n${accountSummary}\nהתחייבויות:\n${recurringSummary}\n50 תנועות אחרונות:\n${recentTx}`;

    // Return a proxy object that mimics a Chat session
    return {
        sendMessage: async (text: string, history: any[] = []) => {
            const contents = [
                ...history,
                { role: 'user', parts: [{ text }] }
            ];
            return await invokeGemini(contents, systemInstruction);
        }
    };
};
