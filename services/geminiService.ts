
import { GoogleGenAI, Chat, Type } from "@google/genai";
import { Transaction, RecurringTransaction, ForecastPoint, Account, TransactionRule } from '../types';

/**
 * Robust helper to check if the API key is present.
 */
export const hasValidApiKey = () => {
  const apiKey = process.env.API_KEY;
  return typeof apiKey === 'string' && apiKey !== "" && apiKey !== "undefined" && apiKey.length > 5;
};

export const getApiKey = () => process.env.API_KEY;

const cleanJsonResponse = (text: string): string => {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
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
    
    // Fix: Initialize GoogleGenAI using process.env.API_KEY directly per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const categoriesList = existingCategories.length > 0 
      ? `בחר מהרשימה: [${existingCategories.join(', ')}]. אם אין התאמה, צור חדשה בעברית.` 
      : `קטלג למילה אחת בעברית.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `קטלג הוצאה: "${payee}" (${amount} ש"ח). ${categoriesList}. החזר רק את שם הקטגוריה.`,
    });
    
    return response.text?.trim() || "כללי";
  } catch (error: any) {
    console.error("AI Categorization failed:", error);
    return "כללי"; 
  }
};

export const generateFinancialInsight = async (transactions: Transaction[], forecast: ForecastPoint[]): Promise<string> => {
  if (!hasValidApiKey()) throw new Error("API_KEY_MISSING");

  // Fix: Initialize GoogleGenAI using process.env.API_KEY directly per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const recentTxsSummary = transactions.slice(0, 15).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');
  const forecastSummary = forecast.filter((_, i) => i % 20 === 0).map(f => `${f.date}: Balance ${Math.round(f.balance)}`).join('\n');

  const prompt = `נתח את הנתונים הפיננסיים הבאים וספק 2-3 תובנות או טיפים מותאמים אישית בעברית.\nתנועות אחרונות:\n${recentTxsSummary}\nתחזית יתרה עתידית:\n${forecastSummary}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction: "אתה יועץ פיננסי מקצועי המומחה בניהול תקציב ותזרים מזומנים. השב בעברית בלבד תוך שימוש בפורמט Markdown נקי וקריא.",
    }
  });
  
  return response.text || "לא ניתן היה לייצר תובנות כרגע.";
};

export const analyzeAnomalies = async (transactions: Transaction[]): Promise<string[]> => {
  try {
    if (!hasValidApiKey()) return [];

    // Fix: Initialize GoogleGenAI using process.env.API_KEY directly per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const recent = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} - ${t.amount} (${t.category})`).join('\n');
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `מצא 2-3 חריגות פיננסיות בתנועות האלה. החזר מערך JSON של מחרוזות בעברית.\nתנועות:\n${recent}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    
    const cleanedText = cleanJsonResponse(response.text || "[]");
    return JSON.parse(cleanedText);
  } catch (e: any) {
    console.error("AI Anomaly Analysis failed:", e);
    return [];
  }
};

export const createFinancialChatSession = (transactions: Transaction[], recurring: RecurringTransaction[], accounts: Account[]): Chat => {
  if (!hasValidApiKey()) throw new Error("API_KEY_MISSING");

  // Fix: Initialize GoogleGenAI using process.env.API_KEY directly per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const accountSummary = accounts.map(a => `- ${a.name}: ${a.currency} ${a.initialBalance}`).join('\n');
  const recurringSummary = recurring.filter(r => r.isActive).map(r => `- ${r.payee}: ${r.amount}`).join('\n');
  const recentTx = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');

  const systemInstruction = `אתה בוט פיננסי עוזר עבור אפליקציית FinanceFlow. השב תמיד בעברית.\nקונטקסט:\nחשבונות:\n${accountSummary}\nהתחייבויות:\n${recurringSummary}\n50 תנועות אחרונות:\n${recentTx}`;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: { 
      systemInstruction,
      temperature: 0.7
    }
  });
};
