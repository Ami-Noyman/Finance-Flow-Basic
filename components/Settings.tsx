
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Account, Transaction, RecurringTransaction, SmartCategoryBudget, Valuation, FinancialGoal, TransactionRule } from '../types';
import { CURRENCIES, formatCurrency } from '../utils/currency';
import { Plus, Trash2, Edit2, Check, X, Wallet, Tag, Info, AlertOctagon, RefreshCw, Calendar, ArrowRightLeft, Download, Upload, Database, Save, Play, UserMinus, Loader, AlertTriangle, ListFilter, User, Terminal, Copy, FileJson, CheckCircle2, SearchCode, LifeBuoy, Zap, Server, AlertCircle, ShieldCheck, Globe, XCircle, Activity, LayoutGrid, Target as TargetIcon, Brain, Sparkles, ExternalLink, Key, HardDrive } from 'lucide-react';
import { clearAllUserData, fetchAccountSubTypes, createAccountSubType, fetchCategoryBudgets, fetchValuations, batchCreateCategoryBudgets, fetchGoals, checkTableHealth, testConnection, fetchRules, saveRule, deleteRule } from '../services/storageService';
import { initSupabase, getDebugInfo, getSupabaseConfig } from '../services/supabaseClient';
import { sortAccounts } from '../utils/finance';
import { getApiKey } from '../services/geminiService';

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
  onSaveAccount, onDeleteAccount, onUpdateCategories, onRenameCategory, onRestoreData, onSaveRule, onDeleteRule
}) => {
  const [activeTab, setActiveTab] = useState<'db' | 'accounts' | 'categories' | 'rules' | 'data'>('accounts');
  const [tableHealth, setTableHealth] = useState<Record<string, boolean>>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const debugInfo = useMemo(() => getDebugInfo(), []);
  const supabaseUrl = useMemo(() => getSupabaseConfig().url, []);
  
  const hasSchemaError = useMemo(() => {
    const keys = Object.keys(tableHealth);
    return keys.length > 0 && keys.some(k => tableHealth[k] === false);
  }, [tableHealth]);

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

  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState('');

  useEffect(() => {
    const handleSubTab = (e: any) => {
        if (e.detail === 'settings:db') {
            setActiveTab('db');
        }
    };
    window.addEventListener('changeTab', handleSubTab);
    return () => window.removeEventListener('changeTab', handleSubTab);
  }, []);

  useEffect(() => { 
    loadSubTypes(); 
    refreshHealth();
  }, []);

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
    if (tableHealth.transaction_rules === false) {
        alert("Action Blocked: The 'transaction_rules' table is missing.");
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

  const handleOpenGeminiKey = async () => {
      const aiStudio = (window as any).aistudio;
      if (aiStudio) {
          await aiStudio.openSelectKey();
          window.location.reload();
      } else {
          alert("To use AI on Vercel, please add API_KEY to your environment variables.");
      }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Application Settings</h2>
        {hasSchemaError && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-xl font-black text-xs uppercase animate-pulse border border-red-200">
            <AlertCircle size={16}/> Schema Out of Sync
          </div>
        )}
      </div>

      <div className="flex flex-wrap border-b border-gray-200 gap-2">
        <button onClick={() => setActiveTab('db')} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm flex items-center gap-2 ${activeTab === 'db' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'} ${hasSchemaError ? 'text-red-500 border-red-500 font-black' : ''}`}>
           <Server size={14} /> Cloud & Database
        </button>
        <button onClick={() => setActiveTab('accounts')} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm ${activeTab === 'accounts' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>Accounts</button>
        <button onClick={() => setActiveTab('categories')} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm ${activeTab === 'categories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>Categories</button>
        <button onClick={() => setActiveTab('rules')} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm flex items-center gap-2 ${activeTab === 'rules' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}><Zap size={14} /> Rules</button>
        <button onClick={() => setActiveTab('data')} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm flex items-center gap-2 ${activeTab === 'data' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}><Database size={14} /> Backup</button>
      </div>
      
      {activeTab === 'db' && (
        <div className="space-y-6">
            <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl space-y-6">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Globe size={28}/></div>
                        <div>
                            <h3 className="text-xl font-black">Environment Connectivity</h3>
                            <p className="text-xs text-slate-400 font-medium">Verify variable injection status</p>
                        </div>
                    </div>
                    <button onClick={handleTestConnection} disabled={isTestingConnection} className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 rounded-2xl text-xs font-black uppercase transition-all shadow-lg active:scale-95">
                        <Activity size={16} className={isTestingConnection ? 'animate-spin' : ''}/> {isTestingConnection ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Deployment Mode</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           <span className={`w-2 h-2 rounded-full ${debugInfo.source.includes('Vercel') || debugInfo.source.includes('Environment') ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                           <span>{debugInfo.source}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Supabase Endpoint</p>
                        <div className="text-sm font-black flex items-center gap-2 overflow-hidden truncate">
                           {debugInfo.hasUrl ? <CheckCircle2 size={14} className="text-green-500 shrink-0"/> : <XCircle size={14} className="text-red-500 shrink-0"/>}
                           <span className="truncate">{debugInfo.hasUrl ? supabaseUrl.replace('https://', '') : 'MISSING'}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">AI Agent Status</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           {getApiKey() ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           <span>{getApiKey() ? 'READY' : 'KEY MISSING'}</span>
                        </div>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Auth Anon Key</p>
                        <div className="text-sm font-black flex items-center gap-2">
                           {debugInfo.hasKey ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           <span>{debugInfo.hasKey ? 'INJECTED' : 'MISSING'}</span>
                        </div>
                    </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-800">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-orange-500/20 text-orange-400 rounded-2xl"><Sparkles size={28}/></div>
                            <div>
                                <h3 className="text-xl font-black">AI Insights & Advisor</h3>
                                <p className="text-xs text-slate-400 font-medium">Power your automated features</p>
                            </div>
                        </div>
                    </div>

                    {!getApiKey() ? (
                        <div className="bg-orange-500/10 border border-orange-500/20 p-6 rounded-2xl space-y-4">
                            <div className="flex items-start gap-4">
                                <AlertTriangle className="text-orange-400 shrink-0 mt-1" size={24}/>
                                <div>
                                    <h4 className="text-sm font-black text-orange-400 uppercase tracking-tight">Gemini Key Missing</h4>
                                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                        For production, add <code>API_KEY</code> to Environment Variables.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4 pt-4">
                                <button onClick={handleOpenGeminiKey} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-6 py-4 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-2 transition-all shadow-xl shadow-orange-600/20">
                                    <Key size={16}/> Use Select Key Dialog
                                </button>
                                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-4 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-2 border border-slate-700 transition-all">
                                    <ExternalLink size={16}/> Billing Docs
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-green-500/10 border border-green-500/20 p-6 rounded-2xl flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-green-500/20 text-green-400 rounded-full"><Check size={20}/></div>
                                <div>
                                    <h4 className="text-sm font-black text-green-400">Gemini AI Active</h4>
                                    <p className="text-xs text-slate-400">AI analysis features are enabled.</p>
                                </div>
                            </div>
                            <button onClick={handleOpenGeminiKey} className="text-xs font-black text-slate-400 hover:text-white uppercase tracking-widest border border-slate-700 px-4 py-2 rounded-lg transition-all">Change Key</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-8 relative overflow-hidden">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Server className="text-brand-500"/> Supabase Schema Health</h3>
                        <p className="text-sm text-slate-500 mt-1 font-medium leading-relaxed">
                            Monitor the availability of tables in your Supabase project.
                        </p>
                    </div>
                    <button onClick={refreshHealth} disabled={isCheckingHealth} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-black uppercase transition-all z-20">
                        <RefreshCw size={14} className={isCheckingHealth ? 'animate-spin' : ''}/> {isCheckingHealth ? 'Checking...' : 'Refresh Health'}
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 relative z-20">
                    {Object.entries(tableHealth).map(([table, exists]) => (
                        <div key={table} className={`p-4 rounded-2xl border flex items-center gap-3 transition-all ${exists ? 'bg-green-50 border-green-100' : 'bg-red-100 border-red-300 scale-105 shadow-lg'}`}>
                            {exists ? <CheckCircle2 size={18} className="text-green-600"/> : <AlertCircle size={20} className="text-red-600 animate-pulse"/>}
                            <div>
                                <div className={`text-[10px] font-black uppercase tracking-wider ${exists ? 'text-slate-700' : 'text-red-900'}`}>{table}</div>
                                <div className={`text-[10px] font-bold ${exists ? 'text-green-700' : 'text-red-700 font-black'}`}>{exists ? 'Online' : 'MISSING'}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {hasSchemaError && (
                    <div className="space-y-4 pt-4 border-t border-slate-50 relative z-20 animate-fade-in">
                        <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-2xl flex gap-5 items-start">
                            <div className="bg-red-500 text-white p-3 rounded-2xl shadow-lg shadow-red-500/20 shrink-0"><HardDrive size={24}/></div>
                            <div className="space-y-2">
                            <h4 className="text-lg font-black text-red-900 uppercase tracking-tight">CRITICAL: SQL REPAIR REQUIRED</h4>
                            <div className="text-sm text-red-800 font-medium leading-relaxed">
                                <p>Tables are missing from your project. Follow these steps:</p>
                                <ol className="list-decimal list-inside space-y-2 mt-4 ml-1">
                                    <li>Copy the script below.</li>
                                    <li>Open <a href="https://app.supabase.com" target="_blank" className="underline font-black">Supabase Dashboard</a>.</li>
                                    <li>Click <strong>SQL Editor</strong> &rarr; <strong>New Query</strong>.</li>
                                    <li>Paste script and click <strong>RUN</strong>.</li>
                                </ol>
                            </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center mt-6">
                            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Initialization & Patch Script</h4>
                            <button onClick={copySql} className="text-xs font-black text-brand-600 flex items-center gap-2 hover:bg-brand-50 px-3 py-1.5 rounded-lg transition-all border border-brand-200">
                                <Copy size={14}/> Copy SQL
                            </button>
                        </div>
                        <div className="p-6 bg-slate-900 rounded-2xl relative overflow-hidden group border border-slate-700 shadow-2xl">
                            <pre className="text-[11px] font-mono text-brand-300 overflow-x-auto max-h-80 custom-scrollbar leading-relaxed">
                                {FULL_SCHEMA_SQL}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
      )}
      
      {activeTab === 'accounts' && (
        <div className="space-y-6">
           <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
               <h3 className="font-black text-xl mb-8 flex items-center gap-3"><Wallet className="text-brand-500"/>{isEditingAccount ? 'Edit' : 'Add'} Account</h3>
               <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                   <div className="md:col-span-2">
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Name</label>
                       <input type="text" value={accName} onChange={e=>setAccName(e.target.value)} placeholder="e.g. Bank Account" className="w-full p-3 border rounded-xl text-sm font-bold focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"/>
                   </div>
                   <div className="md:col-span-1">
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Owner</label>
                       <input type="text" value={accOwner} onChange={e=>setAccOwner(e.target.value)} placeholder="e.g. Personal" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Currency</label>
                       <select value={accCurrency} onChange={e=>setAccCurrency(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white">
                           {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}
                       </select>
                   </div>
               </div>
               <div className="mt-10 flex gap-4 pt-8 border-t border-slate-50">
                   <button onClick={handleSaveAccount} disabled={isSaving} className="px-10 py-4 bg-brand-600 text-white rounded-2xl text-sm font-black transition-all flex items-center gap-2 shadow-xl shadow-brand-500/20 active:scale-95 disabled:opacity-50">
                       {isSaving ? <Loader size={20} className="animate-spin" /> : <Save size={20}/>}
                       {isEditingAccount ? 'Update' : 'Save'}
                   </button>
                   {isEditingAccount && <button onClick={resetAccountForm} className="px-10 py-4 bg-slate-100 text-slate-600 rounded-2xl text-sm font-black transition-all">Cancel</button>}
               </div>
           </div>
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-black text-xl mb-6 flex items-center gap-3"><Tag className="text-brand-500"/>Categories</h3>
            <div className="flex gap-3">
              <input type="text" placeholder="New category..." value={newCategory} onChange={e => setNewCategory(e.target.value)} className="flex-1 p-3 border rounded-xl text-sm font-bold outline-none focus:ring-4 focus:ring-brand-500/10 transition-all" />
              <button onClick={handleAddCategory} className="px-6 py-3 bg-brand-600 text-white rounded-xl text-sm font-black flex items-center gap-2 shadow-lg">Add</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map(cat => (
              <div key={cat} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between group hover:border-brand-300 transition-all">
                <span className="text-sm font-black text-gray-700 truncate">{cat}</span>
                <button onClick={() => confirm(`Delete "${cat}"?`) && onUpdateCategories(categories.filter(c => c !== cat))} className="mt-4 p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
          <div className="space-y-6">
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-black text-xl mb-8 flex items-center gap-3"><Zap className="text-brand-500"/>Rules</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div className="md:col-span-1">
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Payee Contains</label>
                          <input type="text" value={rulePattern} onChange={e=>setRulePattern(e.target.value)} placeholder="e.g. Netflix" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                      </div>
                      <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Assign Category</label>
                          <select value={ruleCategory} onChange={e=>setRuleCategory(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white">
                              {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                      </div>
                  </div>
                  <div className="mt-8 flex gap-4 pt-8 border-t border-slate-50">
                      <button onClick={handleSaveRule} disabled={isSaving} className="px-8 py-3 bg-brand-600 text-white rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-lg">
                          {isSaving && <Loader size={16} className="animate-spin" />} Save Rule
                      </button>
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'data' && (
        <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm text-center space-y-10">
            <h3 className="text-2xl font-black text-slate-800">Backup</h3>
            <div className="grid md:grid-cols-2 gap-8">
                <button onClick={handleExportData} className="p-10 border rounded-[2.5rem] hover:bg-slate-50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                    <div className="p-5 bg-brand-50 text-brand-600 rounded-3xl group-hover:scale-110 transition-transform"><Download size={40}/></div>
                    <div><div className="font-black text-xl text-slate-800">Export Backup</div></div>
                </button>
                <button onClick={() => { setRestoreStage('upload'); setShowRestoreModal(true); }} className="p-10 border rounded-[2.5rem] hover:bg-slate-50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                    <div className="p-5 bg-green-50 text-green-600 rounded-3xl group-hover:scale-110 transition-transform"><Upload size={40}/></div>
                    <div><div className="font-black text-xl text-slate-800">Restore File</div></div>
                </button>
            </div>
            <div className="bg-slate-900 p-8 rounded-[2rem] text-white flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-white/10 rounded-2xl"><UserMinus size={32} className="text-red-400"/></div>
                    <div className="text-left">
                        <h4 className="font-black text-lg">Wipe Data</h4>
                        <p className="text-xs text-slate-400 font-medium">Irreversibly delete all records.</p>
                    </div>
                </div>
                <button onClick={() => confirm("Wipe all cloud data?") && clearAllUserData().then(() => window.location.reload())} className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-black transition-all">Purge Cloud</button>
            </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100">
            <div className="p-8 border-b flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">Restore Backup</h3>
              <button onClick={() => setShowRestoreModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-8 text-center py-12">
               <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
               <button onClick={() => fileInputRef.current?.click()} className="bg-brand-600 text-white px-10 py-4 rounded-2xl font-black shadow-xl">Select File</button>
               {restorePayload && <button onClick={performRestore} className="mt-4 block w-full text-red-600 font-bold underline">Confirm Overwrite</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
