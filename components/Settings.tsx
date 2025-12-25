
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Account, Transaction, RecurringTransaction, SmartCategoryBudget, Valuation, FinancialGoal, TransactionRule } from '../types';
import { CURRENCIES, formatCurrency } from '../utils/currency';
import { Plus, Trash2, Edit2, Check, X, Wallet, Tag, Info, AlertOctagon, RefreshCw, Calendar, ArrowRightLeft, Download, Upload, Database, Save, Play, UserMinus, Loader, AlertTriangle, ListFilter, User, Terminal, Copy, FileJson, CheckCircle2, SearchCode, LifeBuoy, Zap, Server, AlertCircle, ShieldCheck, Globe, XCircle, Activity, LayoutGrid, Target as TargetIcon } from 'lucide-react';
import { clearAllUserData, fetchAccountSubTypes, createAccountSubType, fetchCategoryBudgets, fetchValuations, batchCreateCategoryBudgets, fetchGoals, checkTableHealth, testConnection, fetchRules, saveRule, deleteRule } from '../services/storageService';
import { initSupabase, getDebugInfo } from '../services/supabaseClient';
import { sortAccounts } from '../utils/finance';

interface SettingsProps {
  accounts: Account[];
  categories: string[];
  rules: TransactionRule[];
  transactions?: Transaction[];
  recurring?: RecurringTransaction[];
  goals: FinancialGoal[];
  
  onSaveAccount: (acc: Account) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onUpdateCategories: (categories: string[]) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onRestoreData: (data: any) => Promise<void>;
  onRunAutoProcess?: () => void;
  onSaveRule: (rule: TransactionRule) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}

const IS_ASSET_CLASS = (type: string) => ['savings', 'pension', 'investment', 'loan', 'mortgage'].includes(type);

const FULL_SCHEMA_SQL = `-- FinanceFlow Idempotent Schema Initialization & Patch Script
-- Run this in your Supabase SQL Editor (https://app.supabase.com)

-- 1. Accounts Table
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    owner TEXT,
    type TEXT NOT NULL,
    sub_type TEXT,
    currency TEXT DEFAULT 'ILS',
    color TEXT DEFAULT '#0ea5e9',
    initial_balance NUMERIC DEFAULT 0,
    credit_limit NUMERIC,
    payment_day INTEGER,
    pay_from_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    investment_track TEXT,
    estimated_pension NUMERIC,
    interest_rate NUMERIC,
    term_months INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- SCHEMA PATCH: Add missing columns to 'accounts' if they don't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='interest_rate') THEN
        ALTER TABLE public.accounts ADD COLUMN interest_rate NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='term_months') THEN
        ALTER TABLE public.accounts ADD COLUMN term_months INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='owner') THEN
        ALTER TABLE public.accounts ADD COLUMN owner TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='investment_track') THEN
        ALTER TABLE public.accounts ADD COLUMN investment_track TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='estimated_pension') THEN
        ALTER TABLE public.accounts ADD COLUMN estimated_pension NUMERIC;
    END IF;
END $$;

-- 2. Transactions Table
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    payee TEXT,
    description TEXT,
    notes TEXT,
    category TEXT,
    type TEXT NOT NULL,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    to_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    is_recurring BOOLEAN DEFAULT false,
    recurring_id UUID,
    is_reconciled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Recurring Commitments
CREATE TABLE IF NOT EXISTS public.recurring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    amount_type TEXT DEFAULT 'fixed',
    payee TEXT,
    description TEXT,
    notes TEXT,
    category TEXT,
    type TEXT NOT NULL,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    to_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    frequency TEXT NOT NULL,
    custom_interval INTEGER,
    custom_unit TEXT,
    start_date DATE NOT NULL,
    next_due_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    total_occurrences INTEGER,
    occurrences_processed INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Category Budgets
CREATE TABLE IF NOT EXISTS public.category_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_name TEXT NOT NULL,
    monthly_limit NUMERIC NOT NULL,
    use_average BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Valuations
CREATE TABLE IF NOT EXISTS public.valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    value NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Financial Goals
CREATE TABLE IF NOT EXISTS public.goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_amount NUMERIC NOT NULL DEFAULT 0,
    current_amount NUMERIC NOT NULL DEFAULT 0,
    deadline DATE,
    color TEXT DEFAULT '#0ea5e9',
    account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Transaction Rules (Memorized Transactions)
CREATE TABLE IF NOT EXISTS public.transaction_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    payee_pattern TEXT NOT NULL,
    amount_condition TEXT DEFAULT 'any',
    amount_value NUMERIC,
    category TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Custom Categories
CREATE TABLE IF NOT EXISTS public.categories (
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    PRIMARY KEY (name, user_id)
);

-- 9. Account Sub Types
CREATE TABLE IF NOT EXISTS public.account_sub_types (
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    PRIMARY KEY (name, user_id)
);

-- Enable RLS on all tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_sub_types ENABLE ROW LEVEL SECURITY;

-- Idempotent Policy Creation
DO $$ 
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Users can manage their own %I" ON public.%I', t, t);
        EXECUTE format('CREATE POLICY "Users can manage their own %I" ON public.%I FOR ALL USING (auth.uid() = user_id)', t, t);
    END LOOP;
END $$;
`;

export const Settings: React.FC<SettingsProps> = ({ 
  accounts, categories, rules, transactions = [], recurring = [], goals = [],
  onSaveAccount, onDeleteAccount, onUpdateCategories, onRenameCategory, onRestoreData, onRunAutoProcess,
  onSaveRule, onDeleteRule
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'categories' | 'rules' | 'data' | 'db'>('accounts');
  const [tableHealth, setTableHealth] = useState<Record<string, boolean>>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const debugInfo = useMemo(() => getDebugInfo(), [activeTab]);
  
  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreStage, setRestoreStage] = useState<'upload' | 'summary'>('upload');
  const [restorePayload, setRestorePayload] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Account Form
  const [isEditingAccount, setIsEditingAccount] = useState<string | null>(null);
  const [accName, setAccName] = useState('');
  const [accOwner, setAccOwner] = useState('');
  const [accCurrency, setAccCurrency] = useState('ILS');
  const [accType, setAccType] = useState<Account['type']>('checking');
  const [accSubType, setAccSubType] = useState('');
  const [accInitialBalance, setAccInitialBalance] = useState('');
  const [accCreditLimit, setAccCreditLimit] = useState('');
  const [accPaymentDay, setAccPaymentDay] = useState('');
  const [accPayFromId, setAccPayFromId] = useState('');
  
  const [availableSubTypes, setAvailableSubTypes] = useState<string[]>([]);
  const [newCustomSubType, setNewCustomSubType] = useState('');
  const [accInvestmentTrack, setAccInvestmentTrack] = useState('');
  const [accEstimatedPension, setAccEstimatedPension] = useState('');
  const [accInterestRate, setAccInterestRate] = useState('');
  const [accTermMonths, setAccTermMonths] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Rule Form
  const [isEditingRule, setIsEditingRule] = useState<string | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCondition, setRuleCondition] = useState<'less' | 'greater' | 'equal' | 'any'>('any');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleCategory, setRuleCategory] = useState('');

  const isRulesTableMissing = useMemo(() => tableHealth.transaction_rules === false, [tableHealth]);

  useEffect(() => { 
    loadSubTypes(); 
    refreshHealth();
  }, [activeTab]);

  const loadSubTypes = async () => { const subs = await fetchAccountSubTypes(); setAvailableSubTypes(subs); };
  
  const refreshHealth = async () => {
    setIsCheckingHealth(true);
    const health = await checkTableHealth();
    setTableHealth(health);
    setIsCheckingHealth(false);
  };

  const handleTestConnection = async () => {
      setIsTestingConnection(true);
      const res = await testConnection();
      alert(res.message);
      setIsTestingConnection(false);
  };

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const handleSaveAccount = async () => {
    if (!accName || isSaving) return;
    setIsSaving(true);
    try {
        const initialBalanceVal = parseFloat(accInitialBalance) || 0;
        const creditLimitVal = parseFloat(accCreditLimit) || 0;
        const paymentDayVal = parseInt(accPaymentDay) || undefined;
        let finalSubType = accSubType;
        
        if (finalSubType === 'Other' && newCustomSubType.trim()) {
            finalSubType = newCustomSubType.trim();
            if (!availableSubTypes.includes(finalSubType)) {
                await createAccountSubType(finalSubType);
                setAvailableSubTypes(prev => [...prev, finalSubType!].sort());
            }
        }

        const accountData: Account = { 
            id: isEditingAccount || crypto.randomUUID(), 
            name: accName, 
            owner: accOwner.trim() || undefined, 
            currency: accCurrency, 
            type: accType, 
            subType: finalSubType || undefined, 
            color: isEditingAccount ? (accounts.find(a=>a.id===isEditingAccount)?.color || '#0ea5e9') : '#' + Math.floor(Math.random()*16777215).toString(16), 
            initialBalance: initialBalanceVal, 
            creditLimit: accType === 'credit' ? creditLimitVal : undefined, 
            paymentDay: accType === 'credit' ? paymentDayVal : undefined, 
            payFromAccountId: accType === 'credit' ? (accPayFromId || undefined) : undefined, 
            investmentTrack: IS_ASSET_CLASS(accType) ? (accInvestmentTrack || undefined) : undefined, 
            estimatedPension: accType === 'pension' ? (parseFloat(accEstimatedPension) || undefined) : undefined,
            interestRate: (accType === 'savings' || accType === 'loan' || accType === 'mortgage') ? (parseFloat(accInterestRate) || undefined) : undefined,
            termMonths: (accType === 'loan' || accType === 'mortgage') ? (parseInt(accTermMonths) || undefined) : undefined
        };
        await onSaveAccount(accountData); 
        resetAccountForm();
    } finally { setIsSaving(false); }
  };

  const handleEditAccount = (acc: Account) => { 
    setIsEditingAccount(acc.id); 
    setAccName(acc.name); 
    setAccOwner(acc.owner || ''); 
    setAccCurrency(acc.currency); 
    setAccType(acc.type); 
    setAccSubType(acc.subType || ''); 
    setAccInitialBalance(acc.initialBalance.toString()); 
    setAccCreditLimit(acc.creditLimit?.toString() || ''); 
    setAccPaymentDay(acc.paymentDay?.toString() || ''); 
    setAccPayFromId(acc.payFromAccountId || ''); 
    setAccInvestmentTrack(acc.investmentTrack || ''); 
    setAccEstimatedPension(acc.estimatedPension?.toString() || ''); 
    setAccInterestRate(acc.interestRate?.toString() || '');
    setAccTermMonths(acc.termMonths?.toString() || '');
  };

  const handleDeleteAccount = (id: string) => { if (confirm("Delete this account and all its transactions?")) onDeleteAccount(id); };
  
  const resetAccountForm = () => { 
    setAccName(''); setAccOwner(''); setAccCurrency('ILS'); setAccType('checking'); setAccSubType(''); setNewCustomSubType(''); setAccInitialBalance(''); setAccCreditLimit(''); setAccPaymentDay(''); setAccPayFromId(''); setAccInvestmentTrack(''); setAccEstimatedPension(''); setAccInterestRate(''); setAccTermMonths('');
    setIsEditingAccount(null); 
  };

  const handleSaveRule = async () => {
    if (isRulesTableMissing) {
        alert("Action Blocked: The 'transaction_rules' table is missing. Go to the 'Database' tab and run the patch script first.");
        return;
    }
    if (!rulePattern || !ruleCategory || isSaving) return;
    setIsSaving(true);
    try {
        const rData: TransactionRule = {
            id: isEditingRule || crypto.randomUUID(),
            payeePattern: rulePattern,
            amountCondition: ruleCondition,
            amountValue: ruleCondition !== 'any' ? parseFloat(ruleValue) : undefined,
            category: ruleCategory,
            isActive: true
        };
        await onSaveRule(rData);
        resetRuleForm();
    } finally { setIsSaving(false); }
  };

  const resetRuleForm = () => {
      setIsEditingRule(null); setRulePattern(''); setRuleCondition('any'); setRuleValue(''); setRuleCategory(categories[0] || '');
  };

  const handleEditRule = (r: TransactionRule) => {
      setIsEditingRule(r.id); setRulePattern(r.payeePattern); setRuleCondition(r.amountCondition); setRuleValue(r.amountValue?.toString() || ''); setRuleCategory(r.category);
  };

  const handleExportData = async () => {
    const [budgets, vals, subs, gls, rls] = await Promise.all([ fetchCategoryBudgets(), fetchValuations(), fetchAccountSubTypes(), fetchGoals(), fetchRules() ]);
    const exportData = { accounts, transactions, recurring, categories, rules: rls, categoryBudgets: budgets, valuations: vals, goals: gls, accountSubTypes: subs, backend: 'supabase', timestamp: new Date().toISOString() };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeflow_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target?.result as string);
            if (!json.accounts) throw new Error("Invalid format: Missing accounts.");
            setRestorePayload(json); setRestoreStage('summary');
        } catch (error: any) { alert("Error parsing file: " + error.message); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState('');

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      onUpdateCategories([...categories, newCategory.trim()].sort());
      setNewCategory('');
    }
  };

  const handleSaveRename = () => {
    if (editingCategory && editedCategoryName.trim() && editingCategory !== editedCategoryName.trim()) {
      onRenameCategory(editingCategory, editedCategoryName.trim());
    }
    setEditingCategory(null);
  };

  const performRestore = async () => {
    if (!restorePayload) return;
    setIsSaving(true);
    try { await onRestoreData(restorePayload); setShowRestoreModal(false); } finally { setIsSaving(false); }
  };

  const copySql = () => {
    navigator.clipboard.writeText(FULL_SCHEMA_SQL);
    alert("SQL Patch copied to clipboard!");
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
      <div className="flex space-x-4 border-b border-gray-200 overflow-x-auto">
        <button onClick={() => setActiveTab('accounts')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'accounts' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Accounts</button>
        <button onClick={() => setActiveTab('categories')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'categories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Categories</button>
        <button onClick={() => setActiveTab('rules')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'rules' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Zap size={16} /> Rules</button>
        <button onClick={() => setActiveTab('data')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'data' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Database size={16} /> Backup</button>
        <button onClick={() => setActiveTab('db')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'db' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Server size={16} /> Database</button>
      </div>
      
      {activeTab === 'accounts' && (
        <div className="space-y-6">
           <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
               <h3 className="font-black text-xl mb-8 flex items-center gap-3"><Wallet className="text-brand-500"/>{isEditingAccount ? 'Edit' : 'Add'} Financial Account</h3>
               <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                   <div className="md:col-span-2">
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Account Display Name</label>
                       <input type="text" value={accName} onChange={e=>setAccName(e.target.value)} placeholder="e.g. Bank Hapoalim Main" className="w-full p-3 border rounded-xl text-sm font-bold focus:ring-4 focus:ring-brand-500/10 outline-none transition-all"/>
                   </div>
                   <div className="md:col-span-1">
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Account Owner</label>
                       <input type="text" value={accOwner} onChange={e=>setAccOwner(e.target.value)} placeholder="e.g. Joint, Personal" className="w-full p-3 border rounded-xl text-sm font-bold focus:ring-4 focus:ring-brand-500/10 outline-none transition-all"/>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Currency</label>
                       <select value={accCurrency} onChange={e=>setAccCurrency(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-4 focus:ring-brand-500/10 outline-none">
                           {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}
                       </select>
                   </div>
                   
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Account Category</label>
                       <select value={accType} onChange={e=>setAccType(e.target.value as any)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-4 focus:ring-brand-500/10 outline-none">
                           <option value="checking">Checking (עו"ש)</option>
                           <option value="credit">Credit Card</option>
                           <option value="savings">Savings / Deposits</option>
                           <option value="pension">Pension Fund</option>
                           <option value="investment">Investment Portfolio</option>
                           <option value="loan">Personal Loan</option>
                           <option value="mortgage">Mortgage</option>
                           <option value="cash">Cash</option>
                       </select>
                   </div>

                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Sub-Type / Class</label>
                       <select value={accSubType} onChange={e=>setAccSubType(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-4 focus:ring-brand-500/10 outline-none">
                           <option value="">Generic</option>
                           {availableSubTypes.map(s => <option key={s} value={s}>{s}</option>)}
                           <option value="Other">+ New Type...</option>
                       </select>
                       {accSubType === 'Other' && (
                           <input type="text" placeholder="Custom Sub-type" value={newCustomSubType} onChange={e=>setNewCustomSubType(e.target.value)} className="mt-2 w-full p-2 border rounded-lg text-xs font-bold outline-none"/>
                       )}
                   </div>

                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Initial / Current Balance</label>
                       <input type="number" value={accInitialBalance} onChange={e=>setAccInitialBalance(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-black focus:ring-4 focus:ring-brand-500/10 outline-none"/>
                   </div>

                   {accType === 'credit' && (
                     <>
                       <div><label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Credit Limit</label><input type="number" value={accCreditLimit} onChange={e=>setAccCreditLimit(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/></div>
                       <div><label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Payment Day</label><input type="number" min="1" max="31" value={accPaymentDay} onChange={e=>setAccPaymentDay(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/></div>
                       <div><label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Pay From</label><select value={accPayFromId} onChange={e=>setAccPayFromId(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white outline-none"><option value="">Manual Pay</option>{accounts.filter(a=>a.type==='checking' && a.id !== isEditingAccount).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                     </>
                   )}

                   {IS_ASSET_CLASS(accType) && (
                     <>
                        <div className="md:col-span-1">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Investment Track</label>
                            <input type="text" value={accInvestmentTrack} onChange={e=>setAccInvestmentTrack(e.target.value)} placeholder="e.g. S&P 500, Bond Mix" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                        </div>
                        {(accType === 'savings' || accType === 'loan' || accType === 'mortgage') && (
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Annual Interest (%)</label>
                                <input type="number" step="0.01" value={accInterestRate} onChange={e=>setAccInterestRate(e.target.value)} placeholder="0.00%" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                            </div>
                        )}
                        {accType === 'pension' && (
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Est. Monthly Pension</label>
                                <input type="number" value={accEstimatedPension} onChange={e=>setAccEstimatedPension(e.target.value)} placeholder="₪ 0.00" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                            </div>
                        )}
                        {(accType === 'loan' || accType === 'mortgage') && (
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Remaining Term (Months)</label>
                                <input type="number" value={accTermMonths} onChange={e=>setAccTermMonths(e.target.value)} placeholder="e.g. 120" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                            </div>
                        )}
                     </>
                   )}
               </div>
               <div className="mt-10 flex gap-4 pt-8 border-t border-slate-50">
                   <button onClick={handleSaveAccount} disabled={isSaving} className="px-10 py-4 bg-brand-600 text-white rounded-2xl text-sm font-black transition-all flex items-center gap-2 shadow-xl shadow-brand-500/20 active:scale-95 disabled:opacity-50">
                       {isSaving ? <Loader size={20} className="animate-spin" /> : <Save size={20}/>}
                       {isEditingAccount ? 'Update Account Details' : 'Initialize New Account'}
                   </button>
                   {isEditingAccount && <button onClick={resetAccountForm} className="px-10 py-4 bg-slate-100 text-slate-600 rounded-2xl text-sm font-black transition-all hover:bg-slate-200">Cancel</button>}
               </div>
           </div>

           <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
               {sortedAccounts.map(acc => (
                   <div key={acc.id} className="bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col justify-between group hover:border-brand-300 transition-all">
                       <div className="flex justify-between items-start mb-6">
                           <div className="flex items-center gap-4">
                               <div className="w-3 h-12 rounded-full shadow-inner" style={{ backgroundColor: acc.color }} />
                               <div>
                                   <div className="font-black text-slate-800 flex items-center gap-2">
                                       {acc.name}
                                       {acc.owner && <span className="text-[9px] px-2 py-0.5 bg-slate-100 rounded-lg text-slate-500 uppercase font-black">{acc.owner}</span>}
                                   </div>
                                   <div className="flex items-center gap-2 mt-1">
                                       <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{acc.type}</span>
                                       {acc.subType && <span className="text-[10px] text-brand-500 font-black uppercase tracking-tighter">/ {acc.subType}</span>}
                                   </div>
                               </div>
                           </div>
                           <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button onClick={()=>handleEditAccount(acc)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-colors"><Edit2 size={18}/></button>
                             <button onClick={()=>handleDeleteAccount(acc.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={18}/></button>
                           </div>
                       </div>
                       
                       <div className="bg-slate-50 p-4 rounded-2xl flex justify-between items-end">
                           <div>
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Initial Balance</p>
                               <p className="text-sm font-black text-slate-900">{formatCurrency(acc.initialBalance, acc.currency)}</p>
                           </div>
                           {acc.interestRate && (
                               <div className="text-right">
                                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Rate</p>
                                   <p className="text-xs font-black text-brand-600">{acc.interestRate}%</p>
                               </div>
                           )}
                       </div>
                   </div>
               ))}
           </div>
        </div>
      )}

      {activeTab === 'rules' && (
          <div className="space-y-6">
              {isRulesTableMissing ? (
                  <div className="bg-amber-50 border border-amber-200 p-8 rounded-[2.5rem] flex flex-col items-center text-center animate-fade-in">
                      <div className="p-5 bg-amber-100 text-amber-600 rounded-3xl mb-6 shadow-sm"><AlertCircle size={48}/></div>
                      <h3 className="text-2xl font-black text-amber-900">Rule Engine Not Initialized</h3>
                      <p className="text-amber-800 font-medium max-w-md mt-2 mb-8">The "transaction_rules" table is missing from your database. You need to run the Repair Script to use the memorized transaction engine.</p>
                      <button onClick={() => setActiveTab('db')} className="bg-amber-600 hover:bg-amber-700 text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-amber-500/20 transition-all flex items-center gap-2 active:scale-95 uppercase tracking-widest text-xs">
                          Go to Database Tab
                      </button>
                  </div>
              ) : (
                <>
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                      <h3 className="font-black text-xl mb-8 flex items-center gap-3"><Zap className="text-brand-500"/>{isEditingRule ? 'Edit' : 'Add'} Categorization Rule</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          <div className="md:col-span-1">
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Payee Contains</label>
                              <input type="text" value={rulePattern} onChange={e=>setRulePattern(e.target.value)} placeholder="e.g. Yellow" className="w-full p-3 border rounded-xl text-sm font-bold focus:ring-4 focus:ring-brand-500/10 outline-none transition-all"/>
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Amount Rule</label>
                              <select value={ruleCondition} onChange={e=>setRuleCondition(e.target.value as any)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-4 focus:ring-brand-500/10 outline-none">
                                  <option value="any">Any Amount</option>
                                  <option value="less">Less Than (&lt;)</option>
                                  <option value="greater">Greater Than (&gt;)</option>
                                  <option value="equal">Exactly Equals (=)</option>
                              </select>
                          </div>
                          {ruleCondition !== 'any' && (
                              <div>
                                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Amount Value</label>
                                  <input type="number" value={ruleValue} onChange={e=>setRuleValue(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl text-sm font-black focus:ring-4 focus:ring-brand-500/10 outline-none"/>
                              </div>
                          )}
                          <div>
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Assign Category</label>
                              <select value={ruleCategory} onChange={e=>setRuleCategory(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-4 focus:ring-brand-500/10 outline-none">
                                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                          </div>
                      </div>
                      <div className="mt-8 flex gap-4 pt-8 border-t border-slate-50">
                          <button onClick={handleSaveRule} disabled={isSaving} className="px-8 py-3 bg-brand-600 text-white rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-lg active:scale-95 disabled:opacity-50">
                              {isSaving && <Loader size={16} className="animate-spin" />}
                              {isEditingRule ? 'Update Rule' : 'Create Rule'}
                          </button>
                          {isEditingRule && <button onClick={resetRuleForm} className="px-8 py-3 bg-slate-100 text-slate-600 rounded-xl text-sm font-black transition-all hover:bg-slate-200">Cancel</button>}
                      </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {rules.map(rule => (
                          <div key={rule.id} className="bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col justify-between group hover:border-brand-300 transition-all">
                              <div className="flex justify-between items-start mb-6">
                                  <div className="flex items-center gap-3">
                                      <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl"><Zap size={20}/></div>
                                      <div>
                                          <div className="font-black text-slate-800">"{rule.payeePattern}"</div>
                                          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                              If {rule.amountCondition === 'any' ? 'any amount' : `${rule.amountCondition} ${rule.amountValue}`}
                                          </div>
                                      </div>
                                  </div>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={()=>handleEditRule(rule)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl"><Edit2 size={16}/></button>
                                      <button onClick={()=>onDeleteRule(rule.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl"><Trash2 size={16}/></button>
                                  </div>
                              </div>
                              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</span>
                                  <span className="text-xs font-black text-brand-600">→ {rule.category}</span>
                              </div>
                          </div>
                      ))}
                      {rules.length === 0 && (
                        <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-300 bg-gray-50/50 rounded-[2.5rem] border-4 border-dashed border-gray-100">
                            <Zap size={48} className="mb-4 opacity-20"/>
                            <p className="font-black uppercase tracking-widest text-xs">No transaction rules defined yet.</p>
                        </div>
                      )}
                  </div>
                </>
              )}
          </div>
      )}

      {activeTab === 'db' && (
        <div className="space-y-6">
            <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl space-y-6">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Globe size={28}/></div>
                        <div>
                            <h3 className="text-xl font-black">Database Connection</h3>
                            <p className="text-xs text-slate-400 font-medium">Manage your Supabase cloud link</p>
                        </div>
                    </div>
                    <button onClick={handleTestConnection} disabled={isTestingConnection} className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 rounded-2xl text-xs font-black uppercase transition-all shadow-lg active:scale-95">
                        <Activity size={16} className={isTestingConnection ? 'animate-spin' : ''}/> {isTestingConnection ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Config Source</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           <span className={`w-2 h-2 rounded-full ${debugInfo.source.includes('Vercel') ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                           <span>{debugInfo.source}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">URL Detected</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           {debugInfo.hasUrl ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           <span>{debugInfo.urlPreview}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Anon Key Detected</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           {debugInfo.hasKey ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           <span>{debugInfo.hasKey ? 'PRESENT' : 'MISSING'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-8">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Server className="text-brand-500"/> Database Health</h3>
                        <p className="text-sm text-slate-500 mt-1 font-medium">Verify table status and column availability.</p>
                    </div>
                    <button onClick={refreshHealth} disabled={isCheckingHealth} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-black uppercase transition-all">
                        <RefreshCw size={14} className={isCheckingHealth ? 'animate-spin' : ''}/> {isCheckingHealth ? 'Checking...' : 'Refresh Health'}
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(tableHealth).map(([table, exists]) => (
                        <div key={table} className={`p-4 rounded-2xl border flex items-center gap-3 ${exists ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                            {exists ? <CheckCircle2 size={18} className="text-green-600"/> : <AlertCircle size={18} className="text-red-600"/>}
                            <div>
                                <div className="text-xs font-black uppercase tracking-wider text-slate-700">{table}</div>
                                <div className={`text-[10px] font-bold ${exists ? 'text-green-700' : 'text-red-700'}`}>{exists ? 'Online' : 'MISSING/OLD'}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-50">
                    <div className="flex justify-between items-center">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">Repair / Patch Script</h4>
                        <button onClick={copySql} className="text-xs font-black text-brand-600 flex items-center gap-2 hover:bg-brand-50 px-3 py-1.5 rounded-lg transition-all">
                            <Copy size={14}/> Copy All SQL
                        </button>
                    </div>
                    <div className="p-6 bg-slate-900 rounded-2xl relative overflow-hidden group">
                        <pre className="text-[11px] font-mono text-brand-300 overflow-x-auto max-h-64 custom-scrollbar leading-relaxed">
                            {FULL_SCHEMA_SQL}
                        </pre>
                    </div>
                    <div className="bg-amber-50 p-4 rounded-xl flex gap-3 items-start border border-amber-100">
                        <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0"/>
                        <p className="text-xs font-medium text-amber-800 leading-relaxed">
                            <strong>Fix PGRST204/205 Error:</strong> If you see "table not found" or "column not found", copy the script above, go to your <strong>Supabase Dashboard -&gt; SQL Editor</strong>, paste it, and click <strong>Run</strong>. This will initialize any missing features without affecting existing data.
                        </p>
                    </div>
                </div>
            </div>
        </div>
      )}
      
      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-black text-xl mb-6 flex items-center gap-3"><Tag className="text-brand-500"/>Manage Global Categories</h3>
            <div className="flex gap-3">
              <input type="text" placeholder="Enter new category name..." value={newCategory} onChange={e => setNewCategory(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCategory()} className="flex-1 p-3 border rounded-xl text-sm font-bold outline-none focus:ring-4 focus:ring-brand-500/10 transition-all" />
              <button onClick={handleAddCategory} className="px-6 py-3 bg-brand-600 text-white rounded-xl text-sm font-black flex items-center gap-2 shadow-lg active:scale-95 transition-all"><Plus size={18} /> Add Category</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map(cat => (
              <div key={cat} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between group hover:border-brand-300 transition-all">
                {editingCategory === cat ? (
                  <div className="space-y-3">
                    <input type="text" autoFocus value={editedCategoryName} onChange={e => setEditedCategoryName(e.target.value)} className="w-full p-2 border rounded-lg text-xs font-bold outline-none" />
                    <div className="flex gap-2"><button onClick={handleSaveRename} className="flex-1 py-1.5 bg-green-50 text-green-600 rounded-lg"><Check size={14}/></button><button onClick={() => setEditingCategory(null)} className="flex-1 py-1.5 bg-red-50 text-red-600 rounded-lg"><X size={14}/></button></div>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-black text-gray-700 truncate">{cat}</span>
                    <div className="flex justify-end gap-1 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingCategory(cat); setEditedCategoryName(cat); }} className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"><Edit2 size={14}/></button>
                      <button onClick={() => confirm(`Delete category "${cat}"?`) && onUpdateCategories(categories.filter(c => c !== cat))} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm text-center space-y-10">
            <h3 className="text-2xl font-black text-slate-800">Cloud Backup & Synchronization</h3>
            <div className="grid md:grid-cols-2 gap-8">
                <button onClick={handleExportData} className="p-10 border rounded-[2.5rem] hover:bg-slate-50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                    <div className="p-5 bg-brand-50 text-brand-600 rounded-3xl group-hover:scale-110 transition-transform"><Download size={40}/></div>
                    <div><div className="font-black text-xl text-slate-800">Export Full Backup</div><div className="text-sm text-gray-500 font-medium">Download local JSON snapshot</div></div>
                </button>
                <button onClick={() => { setRestoreStage('upload'); setShowRestoreModal(true); }} className="p-10 border rounded-[2.5rem] hover:bg-slate-50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                    <div className="p-5 bg-green-50 text-green-600 rounded-3xl group-hover:scale-110 transition-transform"><Upload size={40}/></div>
                    <div><div className="font-black text-xl text-slate-800">Restore from File</div><div className="text-sm text-gray-500 font-medium">Upload JSON and overwrite cloud</div></div>
                </button>
            </div>
            <div className="bg-slate-900 p-8 rounded-[2rem] text-white flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-white/10 rounded-2xl"><UserMinus size={32} className="text-red-400"/></div>
                    <div className="text-left">
                        <h4 className="font-black text-lg">Wipe Personal Data</h4>
                        <p className="text-xs text-slate-400 font-medium">Irreversibly delete all records from your cloud account.</p>
                    </div>
                </div>
                <button onClick={() => confirm("WARNING: This will permanently delete ALL data from Supabase. Continue?") && clearAllUserData().then(() => window.location.reload())} className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-black transition-all active:scale-95 shadow-lg shadow-red-500/20">Purge Cloud Store</button>
            </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-8 border-b flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Database className="text-brand-500"/> Restore Cloud Backup</h3>
              <button onClick={() => setShowRestoreModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={24}/></button>
            </div>
            <div className="p-8">
              {restoreStage === 'upload' ? (
                <div className="text-center space-y-6 py-8">
                  <div onClick={() => fileInputRef.current?.click()} className="border-4 border-dashed border-slate-100 rounded-[2.5rem] p-16 hover:border-brand-200 hover:bg-brand-50 transition-all cursor-pointer group">
                    <FileJson size={64} className="mx-auto text-slate-200 group-hover:text-brand-400 mb-6" />
                    <p className="font-black text-slate-400 group-hover:text-brand-600 uppercase tracking-widest text-sm">Drop backup JSON or Click to Select</p>
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 bg-slate-50 rounded-2xl border"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Accounts</p><p className="text-3xl font-black text-slate-800">{restorePayload?.accounts?.length || 0}</p></div>
                    <div className="p-6 bg-slate-50 rounded-2xl border"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Transactions</p><p className="text-3xl font-black text-slate-800">{restorePayload?.transactions?.length || 0}</p></div>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl flex gap-4">
                    <AlertTriangle className="text-orange-600 shrink-0" size={24}/><p className="text-orange-800 text-xs font-bold leading-relaxed">Proceeding will irreversibly replace your current cloud data with the contents of this backup file. We recommend exporting a current backup first.</p>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setRestoreStage('upload')} className="flex-1 px-6 py-4 bg-slate-100 rounded-2xl font-black text-slate-600 hover:bg-slate-200 transition-all">Back</button>
                    <button onClick={performRestore} disabled={isSaving} className="flex-[2] px-6 py-4 bg-brand-600 text-white rounded-2xl font-black shadow-xl shadow-brand-500/20 hover:bg-brand-700 transition-all active:scale-95 flex items-center justify-center gap-2">{isSaving && <Loader size={20} className="animate-spin" />} {isSaving ? 'Restoring Cloud...' : 'Confirm Overwrite'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
