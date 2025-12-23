
import { GoogleGenAI, Chat } from "@google/genai";
import { Transaction, RecurringTransaction, ForecastPoint, Account } from '../types';

/**
 * Creates a fresh Gemini instance to avoid potential state issues or API Key race conditions.
 */
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
    console.error("AI Categorization failed", error);
    return "כללי"; 
  }
};

export const generateFinancialInsight = async (
  transactions: Transaction[],
  forecast: ForecastPoint[]
): Promise<string> => {
  const recentTxsSummary = transactions.slice(0, 15).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');
  const forecastSummary = forecast.filter((_, i) => i % 20 === 0).map(f => `${f.date}: Balance ${Math.round(f.balance)}`).join('\n');

  const prompt = `
    Analyze this financial data and provide 2-3 tailored insights or tips in Hebrew.
    
    Recent Transactions:
    ${recentTxsSummary}
    
    Future Projection Snapshots:
    ${forecastSummary}
    
    IMPORTANT: Be concise. Focus on risks or saving opportunities. Respond exclusively in Hebrew Markdown.
  `;

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
    console.error("AI Insight failed", error);
    return "שגיאה בייצור תובנות. נסה שנית מאוחר יותר.";
  }
};

export const createFinancialChatSession = (
  transactions: Transaction[],
  recurring: RecurringTransaction[],
  accounts: Account[]
): Chat => {
  const ai = getFreshAi();
  
  const accountSummary = accounts.map(a => `- ${a.name} (${a.type}${a.owner ? `, Owner: ${a.owner}` : ''}): ${a.currency} ${a.initialBalance}`).join('\n');
  const recurringSummary = recurring.filter(r => r.isActive).map(r => `- ${r.payee}: ${r.amount} (${r.frequency})`).join('\n');
  const recentTx = transactions.slice(0, 50).map(t => `${t.date}: ${t.payee} (${t.amount})`).join('\n');

  const systemInstruction = `You are a helpful personal finance chatbot for an app called FinanceFlow. 
  Respond in Hebrew. 
  
  Context:
  ACCOUNTS (Including Owners where available):
  ${accountSummary}
  
  RECURRING BILLS:
  ${recurringSummary}
  
  LAST 50 TRANSACTIONS:
  ${recentTx}
  
  Instructions:
  - Help user understand their spending and balances.
  - If asked about specific owners (e.g., "how much does [Owner] have?"), use the Owner field in the ACCOUNTS context.
  - If asked about "עו"ש" refer to checking accounts.
  - Keep answers friendly and accurate.
  `;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: { systemInstruction }
  });
};
