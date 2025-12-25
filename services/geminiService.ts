
import { GoogleGenAI, Chat, Type } from "@google/genai";
import { Transaction, RecurringTransaction, ForecastPoint, Account } from '../types';

/**
 * Interface for AI Studio external key management.
 */
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Fixed: Added optional modifier to resolve modifier mismatch error with other global declarations
    aistudio?: AIStudio;
  }
}

/**
 * Robust helper to get the API key.
 */
export const getApiKey = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey.length < 5) {
    return null;
  }
  return apiKey;
};

/**
 * Creates a fresh instance of the Gemini API client.
 * Strictly follows the guideline: new GoogleGenAI({ apiKey: process.env.API_KEY })
 */
const getFreshAi = () => {
  const key = getApiKey();
  if (!key) {
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * Clean model output that might contain Markdown wrappers.
 */
const cleanJsonResponse = (text: string): string => {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
};

/**
 * Categorizes a transaction into Hebrew using Gemini 3 Flash.
 */
export const categorizeTransaction = async (payee: string, amount: number, existingCategories: string[] = []): Promise<string> => {
  try {
    const ai = getFreshAi();
    const categoriesList = existingCategories.length > 0 
      ? `בחר את הקטגוריה המתאימה ביותר מהרשימה הבאה: [${existingCategories.join(', ')}]. אם אף אחת לא מתאימה, צור קטגוריה חדשה במילה אחת בעברית.` 
      : `קטלג את התנועה הזו למילה אחת קצרה בעברית (למשל: 'מזון', 'חשמל', 'פנאי').`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `משימה: קטלג הוצאה פיננסית לעברית.
      בית עסק: "${payee}"
      סכום: ${amount}
      הנחיות: ${categoriesList}
      פלט: החזר רק את שם הקטגוריה בעברית, ללא הסברים נוספים.`,
    });
    
    return response.text?.trim() || "כללי";
  } catch (error: any) {
    console.error("AI Categorization failed:", error);
    return "כללי"; 
  }
};

/**
 * Generates summary insights from financial history and forecasts.
 */
export const generateFinancialInsight = async (
  transactions: Transaction[],
  forecast: ForecastPoint[]
): Promise<string> => {
  try {
    const ai = getFreshAi();
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
  } catch (error: any) {
    console.error("AI Insight Generation failed:", error);
    if (error.message === "API_KEY_MISSING") throw error;
    return "שגיאה בייצור תובנות AI.";
  }
};

/**
 * Scans recent transactions for anomalies using structured JSON output.
 */
export const analyzeAnomalies = async (transactions: Transaction[]): Promise<string[]> => {
  try {
    const ai = getFreshAi();
    const recent = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} - ${t.amount} (${t.category})`).join('\n');
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `מצא 2-3 חריגות פיננסיות בתנועות האלה (עליות מחירים, הוצאה גבוהה מהרגיל לקטגוריה). 
      החזר מערך JSON של מחרוזות בעברית בלבד. היה קצר ותמציתי.
      תנועות:\n${recent}`,
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

/**
 * Initializes a conversational chat session with financial context.
 */
export const createFinancialChatSession = (
  transactions: Transaction[],
  recurring: RecurringTransaction[],
  accounts: Account[]
): Chat => {
  const ai = getFreshAi();
  const accountSummary = accounts.map(a => `- ${a.name} (${a.type}): ${a.currency} ${a.initialBalance}`).join('\n');
  const recurringSummary = recurring.filter(r => r.isActive).map(r => `- ${r.payee}: ${r.amount} (${r.frequency})`).join('\n');
  const recentTx = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');

  const systemInstruction = `אתה בוט פיננסי עוזר עבור אפליקציית FinanceFlow. השב תמיד בעברית.\nהקשר:\nחשבונות:\n${accountSummary}\nהתחייבויות קבועות:\n${recurringSummary}\n50 תנועות אחרונות:\n${recentTx}`;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: { 
      systemInstruction,
      temperature: 0.7,
      topK: 40,
      topP: 0.95
    }
  });
};
