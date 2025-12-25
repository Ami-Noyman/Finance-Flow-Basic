
import { initSupabase } from './supabaseClient';
import { Transaction, RecurringTransaction, Account, SmartCategoryBudget, Valuation, TransactionType, FinancialGoal, TransactionRule } from '../types';

const stringifyAny = (obj: any): string => {
    if (!obj) return "No error details provided.";
    if (typeof obj === 'string') return obj;
    if (obj instanceof Error) return `${obj.name}: ${obj.message}`;
    try {
        const parts = [];
        if (obj.code) parts.push(`Code: ${obj.code}`);
        if (obj.message) parts.push(`Msg: ${obj.message}`);
        if (obj.details) parts.push(`Detail: ${obj.details}`);
        if (obj.hint) parts.push(`Hint: ${obj.hint}`);
        if (obj.error && typeof obj.error === 'object') {
            const nested = obj.error;
            if (nested.message) parts.push(`Nested Msg: ${nested.message}`);
            if (nested.code) parts.push(`Nested Code: ${nested.code}`);
        }
        if (parts.length > 0) return Array.from(new Set(parts)).join(' | ');
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return "Unserializable error object: " + String(obj);
    }
};

const getContext = async () => {
    const supabase = initSupabase();
    if (!supabase) throw new Error("Supabase client failed to initialize. Check environment variables.");
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const userId = session?.user?.id;
        if (!userId) throw new Error("User session not found. Please log in again.");
        return { supabase, userId };
    } catch (e: any) {
        throw e;
    }
};

export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
    try {
        const { supabase } = await getContext();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error("Connection OK but user identity is null.");
        return { success: true, message: `Successfully connected as ${data.user.email}` };
    } catch (e: any) {
        return { success: false, message: stringifyAny(e) };
    }
};

async function safeFetch<T>(query: Promise<{ data: any[] | null; error: any }>, mapper: (row: any) => T, tableName: string): Promise<T[]> {
    try {
        const result = await query;
        if (result.error) {
            const error = result.error;
            // PGRST205: Missing table, 42P01: Relation does not exist
            const isSchemaError = ['42P01', 'PGRST204', 'PGRST205'].includes(error.code);
            if (isSchemaError) {
                console.warn(`Supabase: Table '${tableName}' is not yet initialized in the DB. Returning empty array.`);
                return []; 
            }
            throw error;
        }
        return (result.data || []).map(mapper);
    } catch (e: any) {
        const isSchemaError = e.code && ['42P01', 'PGRST204', 'PGRST205'].includes(e.code);
        if (!isSchemaError) {
            console.error(`Fetch error in ${tableName}:`, stringifyAny(e));
        }
        return [];
    }
}

export const checkTableHealth = async (): Promise<Record<string, boolean>> => {
    const tables = ['accounts', 'transactions', 'recurring', 'category_budgets', 'valuations', 'goals', 'categories', 'account_sub_types', 'transaction_rules'];
    const health: Record<string, boolean> = {};
    const supabase = initSupabase();
    if (!supabase) return {};

    try {
        await Promise.all(tables.map(async (table) => {
            try {
                const { error } = await supabase.from(table).select('id').limit(1);
                const isError = error && (['42P01', 'PGRST204', 'PGRST205'].includes(error.code));
                health[table] = !isError;
            } catch (e) {
                health[table] = false;
            }
        }));
    } catch (e) {
        return {};
    }
    return health;
};

// --- Mappers ---

const mapAccount = (row: any): Account => ({
    id: row.id,
    name: row.name || 'Unnamed Account',
    owner: row.owner,
    type: row.type || 'checking',
    subType: row.sub_type,
    currency: row.currency || 'ILS',
    color: row.color || '#0ea5e9',
    initialBalance: Number(row.initial_balance || 0),
    creditLimit: row.credit_limit ? Number(row.credit_limit) : undefined,
    paymentDay: row.payment_day,
    payFromAccountId: row.pay_from_account_id,
    investmentTrack: row.investment_track,
    estimatedPension: row.estimated_pension ? Number(row.estimated_pension) : undefined,
    interestRate: row.interest_rate ? Number(row.interest_rate) : undefined,
    termMonths: row.term_months ? Number(row.term_months) : undefined,
});

const accountToDb = (a: Account, userId: string) => {
    const payload: any = {
        id: a.id,
        user_id: userId,
        name: a.name,
        type: a.type,
        currency: a.currency,
        color: a.color,
        initial_balance: a.initialBalance,
    };
    
    if (a.owner !== undefined) payload.owner = a.owner;
    if (a.subType !== undefined) payload.sub_type = a.subType;
    if (a.creditLimit !== undefined) payload.credit_limit = a.creditLimit;
    if (a.paymentDay !== undefined) payload.payment_day = a.paymentDay;
    if (a.payFromAccountId !== undefined) payload.pay_from_account_id = a.payFromAccountId;
    if (a.investmentTrack !== undefined) payload.investment_track = a.investmentTrack;
    if (a.estimatedPension !== undefined) payload.estimated_pension = a.estimatedPension;
    if (a.interestRate !== undefined) payload.interest_rate = a.interestRate;
    if (a.termMonths !== undefined) payload.term_months = a.termMonths;
    
    return payload;
};

const mapRule = (row: any): TransactionRule => ({
    id: row.id,
    payeePattern: row.payee_pattern,
    amountCondition: row.amount_condition,
    amountValue: row.amount_value ? Number(row.amount_value) : undefined,
    category: row.category,
    isActive: row.is_active,
});

const ruleToDb = (rule: TransactionRule, userId: string) => ({
    id: rule.id,
    user_id: userId,
    payee_pattern: rule.payeePattern,
    amount_condition: rule.amountCondition,
    amount_value: rule.amountValue || null,
    category: rule.category,
    is_active: rule.isActive,
});

const mapTransaction = (row: any): Transaction => ({
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    payee: row.payee || row.description || 'Unknown Payee',
    notes: row.notes,
    category: row.category,
    type: row.type as TransactionType,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    isRecurring: row.is_recurring,
    recurringId: row.recurring_id,
    isReconciled: row.is_reconciled,
});

const transactionToDb = (t: Transaction, userId: string) => {
    const safePayee = t.payee || (t as any).description || 'Unknown Payee';
    return {
        id: t.id,
        user_id: userId,
        date: t.date,
        amount: t.amount,
        payee: safePayee,
        description: safePayee,
        notes: t.notes || '',
        category: t.category || 'כללי',
        type: t.type,
        account_id: t.accountId,
        to_account_id: t.toAccountId || null,
        is_recurring: t.isRecurring || false,
        recurring_id: t.recurringId || null,
        is_reconciled: t.isReconciled || false,
    };
};

const mapRecurring = (row: any): RecurringTransaction => ({
    id: row.id,
    amount: Number(row.amount),
    amountType: row.amount_type,
    payee: row.payee || row.description || 'Unknown Payee',
    notes: row.notes,
    category: row.category,
    type: row.type as TransactionType,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    frequency: row.frequency,
    customInterval: row.custom_interval,
    customUnit: row.custom_unit,
    startDate: row.start_date,
    nextDueDate: row.next_due_date,
    isActive: row.is_active,
    totalOccurrences: row.total_occurrences,
    occurrencesProcessed: row.occurrences_processed,
});

const recurringToDb = (r: RecurringTransaction, userId: string) => {
    const safePayee = r.payee || (r as any).description || 'Unknown Payee';
    return {
        id: r.id,
        user_id: userId,
        amount: r.amount,
        amount_type: r.amountType || 'fixed',
        payee: safePayee,
        description: safePayee,
        notes: r.notes || '',
        category: r.category || 'כללי',
        type: r.type,
        account_id: r.accountId,
        to_account_id: r.toAccountId || null,
        frequency: r.frequency,
        custom_interval: r.customInterval || null,
        custom_unit: r.customUnit || null,
        start_date: r.startDate,
        next_due_date: r.nextDueDate,
        is_active: r.isActive ?? true,
        total_occurrences: r.totalOccurrences || null,
        occurrences_processed: r.occurrencesProcessed || 0,
    };
};

const mapBudget = (row: any): SmartCategoryBudget => ({
    id: row.id,
    categoryName: row.category_name,
    monthlyLimit: Number(row.monthly_limit),
    useAverage: row.use_average,
    isActive: row.is_active,
});

const budgetToDb = (b: SmartCategoryBudget, userId: string) => ({
    id: b.id,
    user_id: userId,
    category_name: b.categoryName,
    monthly_limit: b.monthlyLimit,
    use_average: b.useAverage,
    is_active: b.isActive,
});

const mapValuation = (row: any): Valuation => ({
    id: row.id,
    accountId: row.account_id,
    date: row.date,
    value: Number(row.value),
});

const valuationToDb = (v: Valuation, userId: string) => ({
    id: v.id,
    user_id: userId,
    account_id: v.accountId,
    date: v.date,
    value: v.value,
});

const mapGoal = (row: any): FinancialGoal => ({
  id: row.id,
  name: row.name,
  targetAmount: Number(row.target_amount),
  currentAmount: Number(row.current_amount),
  deadline: row.deadline,
  color: row.color,
  accountId: row.account_id,
  isActive: row.is_active,
});

const goalToDb = (g: FinancialGoal, userId: string) => ({
  id: g.id,
  user_id: userId,
  name: g.name,
  target_amount: g.targetAmount,
  current_amount: g.currentAmount,
  deadline: g.deadline || null,
  color: g.color,
  account_id: g.accountId || null,
  is_active: g.isActive,
});

export const fetchAccounts = async (uid?: string): Promise<Account[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<Account>(
            supabase.from('accounts').select('*').eq('user_id', uid || userId),
            mapAccount,
            'accounts'
        );
    } catch (e) { return []; }
};

export const createAccount = async (account: Account) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('accounts').upsert(accountToDb(account, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateAccounts = async (accs: Account[]) => {
    if (!accs.length) return;
    const { supabase, userId } = await getContext();
    const payloads = accs.map(a => accountToDb(a, userId));
    const { error } = await supabase.from('accounts').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const updateAccountsLinks = async (accs: Account[]) => {
    if (!accs.length) return;
    const { supabase, userId } = await getContext();
    for (const acc of accs.filter(a => a.payFromAccountId)) {
        await supabase.from('accounts').update({ pay_from_account_id: acc.payFromAccountId }).eq('id', acc.id).eq('user_id', userId);
    }
};

export const deleteAccount = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('accounts').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchTransactions = async (uid?: string): Promise<Transaction[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<Transaction>(
            supabase.from('transactions').select('*').eq('user_id', uid || userId).order('date', { ascending: false }),
            mapTransaction,
            'transactions'
        );
    } catch (e) { return []; }
};

export const createTransaction = async (t: Transaction) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('transactions').upsert(transactionToDb(t, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateTransactions = async (txs: Transaction[]) => {
    if (!txs.length) return;
    const { supabase, userId } = await getContext();
    const payloads = txs.map(t => transactionToDb(t, userId));
    const { error } = await supabase.from('transactions').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const deleteTransaction = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchRecurring = async (uid?: string): Promise<RecurringTransaction[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<RecurringTransaction>(
            supabase.from('recurring').select('*').eq('user_id', uid || userId),
            mapRecurring,
            'recurring'
        );
    } catch (e) { return []; }
};

export const createRecurring = async (r: RecurringTransaction) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('recurring').upsert(recurringToDb(r, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateRecurring = async (recs: RecurringTransaction[]) => {
    if (!recs.length) return;
    const { supabase, userId } = await getContext();
    const payloads = recs.map(r => recurringToDb(r, userId));
    const { error } = await supabase.from('recurring').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const deleteRecurring = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('recurring').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchCategoryBudgets = async (uid?: string): Promise<SmartCategoryBudget[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<SmartCategoryBudget>(
            supabase.from('category_budgets').select('*').eq('user_id', uid || userId),
            mapBudget,
            'category_budgets'
        );
    } catch (e) { return []; }
};

export const saveCategoryBudget = async (b: SmartCategoryBudget) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('category_budgets').upsert(budgetToDb(b, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateCategoryBudgets = async (budgets: SmartCategoryBudget[]) => {
    if (!budgets.length) return;
    const { supabase, userId } = await getContext();
    const payloads = budgets.map(b => budgetToDb(b, userId));
    const { error } = await supabase.from('category_budgets').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const deleteCategoryBudget = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('category_budgets').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchCategories = async (uid?: string): Promise<string[]> => {
    const defaults = ['מזון', 'שכר דירה', 'חשמל ומים', 'משכורת', 'מסעדות', 'תחבורה', 'בידור', 'בריאות', 'קניות', 'ביטוח', 'חינוך', 'חסכונות', 'שונות'];
    try {
        const { supabase, userId } = await getContext();
        const { data, error } = await supabase.from('categories').select('name').eq('user_id', uid || userId);
        if (error) return defaults;
        const customCats = (data || []).map((d: any) => d.name);
        return Array.from(new Set([...defaults, ...customCats])).sort();
    } catch (e) { return defaults; }
};

export const createCategory = async (name: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('categories').insert({ name, user_id: userId });
    if (error && error.code !== '23505') throw new Error(stringifyAny(error));
};

export const batchCreateCategories = async (names: string[]) => {
    if (!names.length) return;
    const { supabase, userId } = await getContext();
    const payloads = names.map(name => ({ name, user_id: userId }));
    const { error } = await supabase.from('categories').insert(payloads);
    if (error && error.code !== '23505') throw new Error(stringifyAny(error));
};

export const fetchAccountSubTypes = async (uid?: string): Promise<string[]> => {
    const defaults = ['קרן השתלמות', 'קופת גמל', 'קרנות כספיות', 'פוליסת חיסכון'];
    try {
        const { supabase, userId } = await getContext();
        const { data, error } = await supabase.from('account_sub_types').select('name').eq('user_id', uid || userId);
        if (error) return defaults;
        const customSubs = (data || []).map((d: any) => d.name);
        return Array.from(new Set([...defaults, ...customSubs])).sort();
    } catch (e) { return defaults; }
};

export const createAccountSubType = async (name: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('account_sub_types').insert({ name, user_id: userId });
    if (error && error.code !== '23505') throw new Error(stringifyAny(error));
};

export const batchCreateAccountSubTypes = async (names: string[]) => {
    if (!names.length) return;
    const { supabase, userId } = await getContext();
    const payloads = names.map(name => ({ name, user_id: userId }));
    const { error } = await supabase.from('account_sub_types').insert(payloads);
    if (error && error.code !== '23505') throw new Error(stringifyAny(error));
};

export const fetchValuations = async (uid?: string): Promise<Valuation[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<Valuation>(
            supabase.from('valuations').select('*').eq('user_id', uid || userId),
            mapValuation,
            'valuations'
        );
    } catch (e) { return []; }
};

export const saveValuation = async (v: Valuation) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('valuations').upsert(valuationToDb(v, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateValuations = async (vals: Valuation[]) => {
    if (!vals.length) return;
    const { supabase, userId } = await getContext();
    const payloads = vals.map(v => valuationToDb(v, userId));
    const { error } = await supabase.from('valuations').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const deleteValuation = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('valuations').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchGoals = async (uid?: string): Promise<FinancialGoal[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<FinancialGoal>(
            supabase.from('goals').select('*').eq('user_id', uid || userId),
            mapGoal,
            'goals'
        );
    } catch (e) { return []; }
};

export const saveGoal = async (g: FinancialGoal) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('goals').upsert(goalToDb(g, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const batchCreateGoals = async (goals: FinancialGoal[]) => {
    if (!goals.length) return;
    const { supabase, userId } = await getContext();
    const payloads = goals.map(g => goalToDb(g, userId));
    const { error } = await supabase.from('goals').upsert(payloads);
    if (error) throw new Error(stringifyAny(error));
};

export const deleteGoal = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('goals').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const fetchRules = async (uid?: string): Promise<TransactionRule[]> => {
    try {
        const { supabase, userId } = await getContext();
        return safeFetch<TransactionRule>(
            supabase.from('transaction_rules').select('*').eq('user_id', uid || userId),
            mapRule,
            'transaction_rules'
        );
    } catch (e) { return []; }
};

export const saveRule = async (rule: TransactionRule) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('transaction_rules').upsert(ruleToDb(rule, userId));
    if (error) throw new Error(stringifyAny(error));
};

export const deleteRule = async (id: string) => {
    const { supabase, userId } = await getContext();
    const { error } = await supabase.from('transaction_rules').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new Error(stringifyAny(error));
};

export const clearAllUserData = async () => {
    const { supabase, userId } = await getContext();
    const tableOrder = ['transactions', 'recurring', 'valuations', 'category_budgets', 'goals', 'transaction_rules', 'accounts', 'categories', 'account_sub_types'];
    for (const table of tableOrder) {
        try {
            const { error } = await supabase.from(table).delete().eq('user_id', userId);
            if (error && !(['42P01', 'PGRST204', 'PGRST205'].includes(error.code))) {
                console.warn(`Purge failed for table ${table}:`, error.message);
            }
        } catch (e) {}
    }
};
