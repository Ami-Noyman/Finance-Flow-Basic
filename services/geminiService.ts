
import { GoogleGenAI, Chat, Type } from "@google/genai";
import { Transaction, RecurringTransaction, ForecastPoint, Account } from '../types';

const getFreshAi = () => {
  const apiKey = process.env.API_KEY;
  
  // Robust check for missing keys in production builds
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    const errorMsg = "FinanceFlow Error: Gemini API_KEY is missing. " +
                   "1. Ensure you added 'API_KEY' in Vercel Settings -> Environment Variables. " +
                   "2. Ensure you have REDEPLOYED the project after adding the variable.";
    console.error(errorMsg);
    throw new Error("API_KEY_MISSING");
  }
  
  return new GoogleGenAI({ apiKey });
};

export const categorizeTransaction = async (payee: string, amount: number, existingCategories: string[] = []): Promise<string> => {
  try {
    const ai = getFreshAi();
    const categoriesList = existingCategories.length > 0 
      ? `Choose the best fit from this list: [${existingCategories.join(', ')}]. If none fit, generate a new short single word in Hebrew.` 
      : `Categorize this transaction into a single short Hebrew word (e.g., 'מזון', 'חשמל', 'משכורת').`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Task: Categorize a financial transaction into Hebrew.
      Payee: "${payee}"
      Amount: ${amount}
      Instructions: ${categoriesList}
      Output: Only return the Hebrew category name, nothing else.`,
    });
    return response.text?.trim() || "כללי";
  } catch (error: any) {
    if (error.message === "API_KEY_MISSING") {
        return "כללי (Missing API Key)";
    }
    console.error("Categorization failed:", error);
    return "כללי"; 
  }
};

export const generateFinancialInsight = async (
  transactions: Transaction[],
  forecast: ForecastPoint[]
): Promise<string> => {
  try {
    const ai = getFreshAi();
    const recentTxsSummary = transactions.slice(0, 15).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');
    const forecastSummary = forecast.filter((_, i) => i % 20 === 0).map(f => `${f.date}: Balance ${Math.round(f.balance)}`).join('\n');

    const prompt = `Analyze this financial data and provide 2-3 tailored insights or tips in Hebrew.\nRecent Transactions:\n${recentTxsSummary}\nFuture Projection Snapshots:\n${forecastSummary}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a professional financial advisor. Respond in Hebrew using clean Markdown formatting.",
      }
    });
    return response.text || "שגיאה בייצור תובנות.";
  } catch (error: any) {
    if (error.message === "API_KEY_MISSING") {
        return "שגיאה: מפתח ה-API חסר בהגדרות השרת. אנא בדוק את הגדרות ה-Environment Variables ב-Vercel ופרוס מחדש.";
    }
    return "שגיאה בייצור תובנות.";
  }
};

export const analyzeAnomalies = async (transactions: Transaction[]): Promise<string[]> => {
  try {
    const ai = getFreshAi();
    const recent = transactions.slice(0, 100).map(t => `${t.date}: ${t.payee} - ${t.amount} (${t.category})`).join('\n');
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find 2-3 financial anomalies in these transactions (price increases, unusually high spend compared to category average). 
      Output as a JSON array of Hebrew strings. Be very concise.
      Transactions:\n${recent}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (e: any) {
    console.error("Anomaly analysis failed:", e);
    return [];
  }
};

export const createFinancialChatSession = (
  transactions: Transaction[],
  recurring: RecurringTransaction[],
  accounts: Account[]
): Chat => {
  const ai = getFreshAi();
  const accountSummary = accounts.map(a => `- ${a.name} (${a.type}): ${a.currency} ${a.initialBalance}`).join('\n');
  const recurringSummary = recurring.filter(r => r.isActive).map(r => `- ${r.payee}: ${r.amount} (${r.frequency})`).join('\n');
  const recentTx = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');

  const systemInstruction = `You are a helpful personal finance chatbot for an app called FinanceFlow. Respond in Hebrew.\nContext:\nACCOUNTS:\n${accountSummary}\nRECURRING:\n${recurringSummary}\nLAST 50 TX:\n${recentTx}`;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: { systemInstruction }
  });
};
