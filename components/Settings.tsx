
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Account, Transaction, RecurringTransaction, SmartCategoryBudget, Valuation, FinancialGoal } from '../types';
import { CURRENCIES, formatCurrency } from '../utils/currency';
import { Plus, Trash2, Edit2, Check, X, Wallet, Tag, Info, AlertOctagon, RefreshCw, Calendar, ArrowRightLeft, Download, Upload, Database, Save, Play, UserMinus, Loader, AlertTriangle, ListFilter, User, Terminal, Copy, FileJson, CheckCircle2, SearchCode, LifeBuoy, Zap, Server, AlertCircle, ShieldCheck, Globe } from 'lucide-react';
import { clearAllUserData, fetchAccountSubTypes, createAccountSubType, fetchCategoryBudgets, fetchValuations, batchCreateCategoryBudgets, fetchGoals, checkTableHealth } from '../services/storageService';
import { initSupabase, getDebugInfo } from '../services/supabaseClient';
import { sortAccounts } from '../utils/finance';

interface SettingsProps {
  accounts: Account[];
  categories: string[];
  transactions?: Transaction[];
  recurring?: RecurringTransaction[];
  goals: FinancialGoal[];
  
  onSaveAccount: (acc: Account) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onUpdateCategories: (categories: string[]) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onRestoreData: (data: any) => Promise<void>;
  onRunAutoProcess?: () => void;
}

const IS_ASSET_CLASS = (type: string) => ['savings', 'pension', 'investment', 'loan', 'mortgage'].includes(type);

const FULL_SCHEMA_SQL = `-- FinanceFlow Idempotent Schema Initialization
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

-- 7. Custom Categories
CREATE TABLE IF NOT EXISTS public.categories (
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    PRIMARY KEY (name, user_id)
);

-- 8. Account Sub Types
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
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_sub_types ENABLE ROW LEVEL SECURITY;

-- Idempotent Policy Creation (Drop before Create)
DROP POLICY IF EXISTS "Users can manage their own accounts" ON public.accounts;
CREATE POLICY "Users can manage their own accounts" ON public.accounts FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;
CREATE POLICY "Users can manage their own transactions" ON public.transactions FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own recurring" ON public.recurring;
CREATE POLICY "Users can manage their own recurring" ON public.recurring FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own budgets" ON public.category_budgets;
CREATE POLICY "Users can manage their own budgets" ON public.category_budgets FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own valuations" ON public.valuations;
CREATE POLICY "Users can manage their own valuations" ON public.valuations FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own goals" ON public.goals;
CREATE POLICY "Users can manage their own goals" ON public.goals FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own categories" ON public.categories;
CREATE POLICY "Users can manage their own categories" ON public.categories FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own sub_types" ON public.account_sub_types;
CREATE POLICY "Users can manage their own sub_types" ON public.account_sub_types FOR ALL USING (auth.uid() = user_id);`;

export const Settings: React.FC<SettingsProps> = ({ 
  accounts, categories, transactions = [], recurring = [], goals = [],
  onSaveAccount, onDeleteAccount, onUpdateCategories, onRenameCategory, onRestoreData, onRunAutoProcess
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'categories' | 'data' | 'db'>('accounts');
  const [tableHealth, setTableHealth] = useState<Record<string, boolean>>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { 
    loadSubTypes(); 
    if (activeTab === 'db') refreshHealth();
  }, [activeTab]);

  const loadSubTypes = async () => { const subs = await fetchAccountSubTypes(); setAvailableSubTypes(subs); };
  
  const refreshHealth = async () => {
    setIsCheckingHealth(true);
    const health = await checkTableHealth();
    setTableHealth(health);
    setIsCheckingHealth(false);
  };

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const handleSaveAccount = async () => {
    if (!accName || isSaving) return;
    setIsSaving(true);
    try {
        const initialBalanceVal = parseFloat(accInitialBalance) || 0;
        const creditLimitVal = parseFloat(accCreditLimit) || 0;
        const paymentDayVal = parseInt(accPaymentDay) || undefined;
        let finalSubType = IS_ASSET_CLASS(accType) ? accSubType : undefined;
        
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
            subType: finalSubType, 
            color: isEditingAccount ? (accounts.find(a=>a.id===isEditingAccount)?.color || '#0ea5e9') : '#' + Math.floor(Math.random()*16777215).toString(16), 
            initialBalance: initialBalanceVal, 
            creditLimit: creditLimitVal, 
            paymentDay: paymentDayVal, 
            payFromAccountId: accPayFromId || undefined, 
            investmentTrack: accInvestmentTrack || undefined, 
            estimatedPension: parseFloat(accEstimatedPension) || undefined,
            interestRate: parseFloat(accInterestRate) || undefined
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
  };

  const handleDeleteAccount = (id: string) => { if (confirm("Delete this account and all its transactions?")) onDeleteAccount(id); };
  
  const resetAccountForm = () => { 
    setAccName(''); setAccOwner(''); setAccCurrency('ILS'); setAccType('checking'); setAccSubType(''); setNewCustomSubType(''); setAccInitialBalance(''); setAccCreditLimit(''); setAccPaymentDay(''); setAccPayFromId(''); setAccInvestmentTrack(''); setAccEstimatedPension(''); setAccInterestRate('');
    setIsEditingAccount(null); 
  };

  const handleExportData = async () => {
    const [budgets, vals, subs, gls] = await Promise.all([ fetchCategoryBudgets(), fetchValuations(), fetchAccountSubTypes(), fetchGoals() ]);
    const exportData = { accounts, transactions, recurring, categories, categoryBudgets: budgets, valuations: vals, goals: gls, accountSubTypes: subs, backend: 'supabase', timestamp: new Date().toISOString() };
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
    alert("SQL Schema copied to clipboard!");
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
      <div className="flex space-x-4 border-b border-gray-200 overflow-x-auto">
        <button onClick={() => setActiveTab('accounts')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'accounts' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Accounts</button>
        <button onClick={() => setActiveTab('categories')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'categories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Categories</button>
        <button onClick={() => setActiveTab('data')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'data' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Database size={16} /> Backup</button>
        <button onClick={() => setActiveTab('db')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'db' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Server size={16} /> Database</button>
      </div>
      
      {activeTab === 'accounts' && (
        <div className="space-y-6">
           <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
               <h3 className="font-bold text-lg mb-4">{isEditingAccount ? 'Edit' : 'Add'} Account</h3>
               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                   <div className="md:col-span-1"><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Account Name</label><input type="text" value={accName} onChange={e=>setAccName(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   <div className="md:col-span-1"><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Owner</label><input type="text" value={accOwner} onChange={e=>setAccOwner(e.target.value)} placeholder="e.g. Joint, Private" className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Currency</label><select value={accCurrency} onChange={e=>setAccCurrency(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none">{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Account Type</label><select value={accType} onChange={e=>setAccType(e.target.value as any)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none"><option value="checking">Checking (עו"ש)</option><option value="credit">Credit Card</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="investment">Investment</option><option value="pension">Pension</option><option value="loan">Personal Loan</option><option value="mortgage">Mortgage</option></select></div>
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Initial Balance</label><input type="number" value={accInitialBalance} onChange={e=>setAccInitialBalance(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   {accType === 'credit' && (
                     <>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Credit Limit</label><input type="number" value={accCreditLimit} onChange={e=>setAccCreditLimit(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Payment Day</label><input type="number" min="1" max="31" value={accPaymentDay} onChange={e=>setAccPaymentDay(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Pay From</label><select value={accPayFromId} onChange={e=>setAccPayFromId(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none"><option value="">Manual Pay</option>{accounts.filter(a=>a.type==='checking' && a.id !== isEditingAccount).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                     </>
                   )}
               </div>
               <div className="mt-8 flex gap-3">
                   <button onClick={handleSaveAccount} disabled={isSaving} className="px-8 py-3 bg-brand-600 text-white rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-lg shadow-brand-500/20 active:scale-95 disabled:opacity-50">{isSaving && <Loader size={16} className="animate-spin" />}{isEditingAccount ? 'Update Account' : 'Create Account'}</button>
                   {isEditingAccount && <button onClick={resetAccountForm} className="px-8 py-3 bg-gray-100 text-gray-600 rounded-xl text-sm font-black transition-all hover:bg-gray-200">Cancel</button>}
               </div>
           </div>
           <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
               {sortedAccounts.map(acc => (
                   <div key={acc.id} className="bg-white p-5 rounded-2xl border shadow-sm flex justify-between items-center group hover:border-brand-300 transition-all">
                       <div className="flex items-center gap-4">
                           <div className="w-2 h-10 rounded-full" style={{ backgroundColor: acc.color }} />
                           <div>
                               <div className="font-black text-slate-800 flex items-center gap-2">{acc.name}{acc.owner && <span className="text-[9px] px-2 py-0.5 bg-slate-100 rounded-lg text-slate-500 uppercase font-black">{acc.owner}</span>}</div>
                               <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{acc.type}</div>
                           </div>
                       </div>
                       <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button onClick={()=>handleEditAccount(acc)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 size={18}/></button>
                         <button onClick={()=>handleDeleteAccount(acc.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={18}/></button>
                       </div>
                   </div>
               ))}
           </div>
        </div>
      )}

      {activeTab === 'db' && (
        <div className="space-y-6">
            {/* Connection Diagnostics Section */}
            <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl space-y-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Globe size={28}/></div>
                    <div>
                        <h3 className="text-xl font-black">Production Diagnostics</h3>
                        <p className="text-xs text-slate-400 font-medium">Verify your Vercel Environment connection</p>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Config Source</p>
                        <p className="text-sm font-black flex items-center gap-2">
                           <div className={`w-2 h-2 rounded-full ${debugInfo.source.includes('Vercel') ? 'bg-green-500' : 'bg-orange-500'}`} />
                           {debugInfo.source}
                        </p>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">URL Detected</p>
                        <p className="text-sm font-black flex items-center gap-2">
                           {debugInfo.hasUrl ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           {debugInfo.urlPreview}
                        </p>
                    </div>
                    <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Anon Key Detected</p>
                        <p className="text-sm font-black flex items-center gap-2">
                           {debugInfo.hasKey ? <CheckCircle2 size={14} className="text-green-500"/> : <XCircle size={14} className="text-red-500"/>}
                           {debugInfo.hasKey ? 'PRESENT' : 'MISSING'}
                        </p>
                    </div>
                </div>

                {!debugInfo.hasUrl && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 items-start">
                        <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={18}/>
                        <div className="text-xs space-y-2">
                            <p className="font-bold text-red-200">Variables Missing on Vercel!</p>
                            <p className="text-red-100/70">Go to <strong>Vercel Dashboard > Settings > Environment Variables</strong> and add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>. You must trigger a new deployment for these to work.</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-8">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Server className="text-brand-500"/> Database Health</h3>
                        <p className="text-sm text-slate-500 mt-1 font-medium">Verify that your Supabase tables are correctly initialized.</p>
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
                                <div className={`text-[10px] font-bold ${exists ? 'text-green-700' : 'text-red-700'}`}>{exists ? 'Online' : 'MISSING'}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-50">
                    <div className="flex justify-between items-center">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">Initialization Script</h4>
                        <button onClick={copySql} className="text-xs font-black text-brand-600 flex items-center gap-2 hover:bg-brand-50 px-3 py-1.5 rounded-lg transition-all">
                            <Copy size={14}/> Copy All SQL
                        </button>
                    </div>
                    <div className="p-6 bg-slate-900 rounded-2xl relative overflow-hidden group">
                        <pre className="text-[11px] font-mono text-brand-300 overflow-x-auto max-h-64 custom-scrollbar leading-relaxed">
                            {FULL_SCHEMA_SQL}
                        </pre>
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-40 pointer-events-none"/>
                    </div>
                    <div className="bg-brand-50 p-4 rounded-xl flex gap-3 items-start">
                        <Info size={18} className="text-brand-600 mt-0.5 shrink-0"/>
                        <p className="text-xs font-medium text-brand-800">
                            <strong>How to fix missing tables:</strong> Go to your Supabase Dashboard, open the <strong>SQL Editor</strong>, paste the script above, and click <strong>Run</strong>. This will create any missing tables (including <code>goals</code>) and set up the necessary security policies.
                        </p>
                    </div>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-lg mb-4">Manage Categories</h3>
            <div className="flex gap-2">
              <input type="text" placeholder="New category name..." value={newCategory} onChange={e => setNewCategory(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCategory()} className="flex-1 p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-brand-500" />
              <button onClick={handleAddCategory} className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium flex items-center gap-2"><Plus size={16} /> Add</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categories.map(cat => (
              <div key={cat} className="bg-white p-3 rounded-xl border border-gray-200 flex flex-col justify-between group hover:border-brand-300 transition-all">
                {editingCategory === cat ? (
                  <div className="space-y-2">
                    <input type="text" autoFocus value={editedCategoryName} onChange={e => setEditedCategoryName(e.target.value)} className="w-full p-1 border rounded text-xs" />
                    <div className="flex gap-1"><button onClick={handleSaveRename} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14}/></button><button onClick={() => setEditingCategory(null)} className="p-1 text-red-600 hover:bg-red-50 rounded"><X size={14}/></button></div>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-bold text-gray-700 truncate">{cat}</span>
                    <div className="flex justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingCategory(cat); setEditedCategoryName(cat); }} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 size={14}/></button>
                      <button onClick={() => confirm(`Delete category "${cat}"?`) && onUpdateCategories(categories.filter(c => c !== cat))} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm text-center space-y-8">
            <h3 className="text-xl font-black text-slate-800">Cloud Data Management</h3>
            <div className="grid md:grid-cols-2 gap-4">
                <button onClick={handleExportData} className="p-8 border rounded-[2rem] hover:bg-slate-50 transition-all text-left flex items-center gap-6 group">
                    <div className="p-4 bg-brand-50 text-brand-600 rounded-2xl group-hover:scale-110 transition-transform"><Download size={32}/></div>
                    <div><div className="font-black text-lg">Export Cloud Data</div><div className="text-sm text-gray-500 font-medium">Download full JSON backup</div></div>
                </button>
                <button onClick={() => { setRestoreStage('upload'); setShowRestoreModal(true); }} className="p-8 border rounded-[2rem] hover:bg-slate-50 transition-all text-left flex items-center gap-6 group">
                    <div className="p-4 bg-green-50 text-green-600 rounded-2xl group-hover:scale-110 transition-transform"><Upload size={32}/></div>
                    <div><div className="font-black text-lg">Import Backup File</div><div className="text-sm text-gray-500 font-medium">Upload JSON and overwrite cloud</div></div>
                </button>
            </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in">
            <div className="p-8 border-b flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Database className="text-brand-500"/> Restore Backup</h3>
              <button onClick={() => setShowRestoreModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-8">
              {restoreStage === 'upload' ? (
                <div className="text-center space-y-6 py-8">
                  <div onClick={() => fileInputRef.current?.click()} className="border-4 border-dashed border-slate-100 rounded-[2rem] p-12 hover:border-brand-200 hover:bg-brand-50 transition-all cursor-pointer group">
                    <Upload size={48} className="mx-auto text-slate-200 group-hover:text-brand-400 mb-4" />
                    <p className="font-black text-slate-400 group-hover:text-brand-600 uppercase tracking-widest">Select Backup JSON File</p>
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border"><p className="text-[10px] font-black text-slate-400 uppercase">Accounts</p><p className="text-2xl font-black">{restorePayload?.accounts?.length || 0}</p></div>
                    <div className="p-4 bg-slate-50 rounded-2xl border"><p className="text-[10px] font-black text-slate-400 uppercase">Transactions</p><p className="text-2xl font-black">{restorePayload?.transactions?.length || 0}</p></div>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl flex gap-4">
                    <AlertTriangle className="text-orange-600 shrink-0" /><p className="text-orange-800 text-xs font-medium">Clicking restore will delete all current cloud data and replace it with this backup.</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setRestoreStage('upload')} className="flex-1 px-6 py-4 bg-slate-100 rounded-2xl font-black text-slate-600">Back</button>
                    <button onClick={performRestore} disabled={isSaving} className="flex-[2] px-6 py-4 bg-brand-600 text-white rounded-2xl font-black">{isSaving ? 'Restoring...' : 'Confirm Restore'}</button>
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

const XCircle = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
    </svg>
);
