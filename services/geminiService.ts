
import { GoogleGenAI, Chat, Type } from "@google/genai";
import { Transaction, RecurringTransaction, ForecastPoint, Account } from '../types';

const getFreshAi = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

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
  } catch (error) {
    return "כללי"; 
  }
};

export const generateFinancialInsight = async (
  transactions: Transaction[],
  forecast: ForecastPoint[]
): Promise<string> => {
  const recentTxsSummary = transactions.slice(0, 15).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');
  const forecastSummary = forecast.filter((_, i) => i % 20 === 0).map(f => `${f.date}: Balance ${Math.round(f.balance)}`).join('\n');

  const prompt = `Analyze this financial data and provide 2-3 tailored insights or tips in Hebrew.\nRecent Transactions:\n${recentTxsSummary}\nFuture Projection Snapshots:\n${forecastSummary}`;

  try {
    const ai = getFreshAi();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a professional financial advisor. Respond in Hebrew using clean Markdown formatting.",
      }
    });
    return response.text || "שגיאה בייצור תובנות.";
  } catch (error) {
    return "שגיאה בייצור תובנות.";
  }
};

export const analyzeAnomalies = async (transactions: Transaction[]): Promise<string[]> => {
  try {
    const recent = transactions.slice(0, 100).map(t => `${t.date}: ${t.payee} - ${t.amount} (${t.category})`).join('\n');
    const ai = getFreshAi();
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
  } catch (e) {
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
