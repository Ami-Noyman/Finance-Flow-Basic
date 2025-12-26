
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
  onCreateCategory: (name: string) => Promise<void>;
  onDeleteCategory: (name: string) => Promise<void>;
}

const IS_ASSET_CLASS = (type: string) => ['savings', 'pension', 'investment', 'loan', 'mortgage'].includes(type);

const FULL_SCHEMA_SQL = `-- FinanceFlow Idempotent Schema Script
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

-- Note: Additional tables (recurring, valuations, goals, etc.) follow the same pattern.
`;

export const Settings: React.FC<SettingsProps> = ({ 
  accounts, categories, rules, transactions = [], recurring = [], goals = [],
  onSaveAccount, onDeleteAccount, onUpdateCategories, onRenameCategory, onRestoreData, onSaveRule, onDeleteRule, onCreateCategory, onDeleteCategory
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'categories' | 'rules' | 'db' | 'data'>('accounts');
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
  const [restorePayload, setRestorePayload] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Account Form State
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
  const [accInvestmentTrack, setAccInvestmentTrack] = useState('');
  const [accEstimatedPension, setAccEstimatedPension] = useState('');
  const [accInterestRate, setAccInterestRate] = useState('');
  const [accTermMonths, setAccTermMonths] = useState('');
  
  const [availableSubTypes, setAvailableSubTypes] = useState<string[]>([]);
  const [newCustomSubType, setNewCustomSubType] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Category Edit State
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState('');

  // Rule Form State
  const [isEditingRule, setIsEditingRule] = useState<string | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCondition, setRuleCondition] = useState<'less' | 'greater' | 'equal' | 'any'>('any');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleCategory, setRuleCategory] = useState(categories[0] || '');

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

  const copySql = () => {
    navigator.clipboard.writeText(FULL_SCHEMA_SQL).then(() => alert("SQL script copied to clipboard!"));
  };

  const performRestore = async () => {
    if (!restorePayload) return;
    if (confirm("This will overwrite all existing cloud data. Are you sure?")) {
        await onRestoreData(restorePayload);
        setShowRestoreModal(false);
        setRestorePayload(null);
    }
  };

  const handleTestConnection = async () => {
      setIsTestingConnection(true);
      const res = await testConnection();
      alert(res.message);
      setIsTestingConnection(false);
  };

  const handleSaveAccount = async () => {
    if (!accName || isSaving) return;
    setIsSaving(true);
    try {
        const initialBalanceVal = parseFloat(accInitialBalance) || 0;
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
            creditLimit: accType === 'credit' ? parseFloat(accCreditLimit) : undefined, 
            paymentDay: accType === 'credit' ? parseInt(accPaymentDay) : undefined, 
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

  const resetAccountForm = () => { 
    setAccName(''); setAccOwner(''); setAccCurrency('ILS'); setAccType('checking'); setAccSubType(''); setNewCustomSubType(''); setAccInitialBalance(''); setAccCreditLimit(''); setAccPaymentDay(''); setAccPayFromId(''); setAccInvestmentTrack(''); setAccEstimatedPension(''); setAccInterestRate(''); setAccTermMonths('');
    setIsEditingAccount(null); 
  };

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      onCreateCategory(newCategory.trim());
      setNewCategory('');
    }
  };

  const saveRenamedCategory = () => {
    if (editingCategory && editedCategoryName.trim() && editingCategory !== editedCategoryName.trim()) {
      onRenameCategory(editingCategory, editedCategoryName.trim());
    }
    setEditingCategory(null);
  };

  const handleSaveRule = async () => {
    if (!rulePattern || !ruleCategory || isSaving) return;
    setIsSaving(true);
    try {
        await onSaveRule({
            id: isEditingRule || crypto.randomUUID(),
            payeePattern: rulePattern,
            amountCondition: ruleCondition,
            amountValue: ruleCondition !== 'any' ? parseFloat(ruleValue) : undefined,
            category: ruleCategory,
            isActive: true
        });
        setIsEditingRule(null); setRulePattern(''); setRuleCondition('any'); setRuleValue('');
    } finally { setIsSaving(false); }
  };

  const handleExportData = async () => {
    const [budgets, vals, subs, gls, rls] = await Promise.all([ fetchCategoryBudgets(), fetchValuations(), fetchAccountSubTypes(), fetchGoals(), fetchRules() ]);
    const exportData = { accounts, transactions, recurring, categories, rules: rls, categoryBudgets: budgets, valuations: vals, goals: gls, accountSubTypes: subs, timestamp: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeflow_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target?.result as string);
            setRestorePayload(json); setShowRestoreModal(true);
        } catch (error) { alert("Invalid backup file."); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Application Settings</h2>
        {hasSchemaError && <div className="px-4 py-2 bg-red-100 text-red-700 rounded-xl font-black text-xs uppercase animate-pulse border border-red-200 flex items-center gap-2"><AlertCircle size={14}/> Database Out of Sync</div>}
      </div>

      <div className="flex flex-wrap border-b border-gray-200 gap-2">
        {(['accounts', 'categories', 'rules', 'db', 'data'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 px-4 font-bold transition-colors border-b-2 text-sm capitalize ${activeTab === tab ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
                {tab === 'db' ? 'Cloud & DB' : tab === 'data' ? 'Backup & Restore' : tab}
            </button>
        ))}
      </div>
      
      {activeTab === 'accounts' && (
        <div className="space-y-8">
           <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
               <h3 className="font-black text-xl mb-8 flex items-center gap-3 text-slate-800"><Wallet className="text-brand-500"/>{isEditingAccount ? 'Edit' : 'Add'} Financial Account</h3>
               
               <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                   <div className="md:col-span-2">
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Account Name</label>
                       <input type="text" value={accName} onChange={e=>setAccName(e.target.value)} placeholder="e.g. Main Checking" className="w-full p-3 border rounded-xl text-sm font-bold focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"/>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Type</label>
                       <select value={accType} onChange={e=>setAccType(e.target.value as any)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white outline-none">
                           <option value="checking">Checking / Current</option>
                           <option value="credit">Credit Card</option>
                           <option value="savings">Savings / Deposit</option>
                           <option value="investment">Investment Portfolio</option>
                           <option value="pension">Pension Fund</option>
                           <option value="loan">Loan / Liability</option>
                           <option value="mortgage">Mortgage</option>
                           <option value="cash">Cash Account</option>
                       </select>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Owner</label>
                       <input type="text" value={accOwner} onChange={e=>setAccOwner(e.target.value)} placeholder="e.g. Family" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                   </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Current/Initial Balance</label>
                       <input type="number" value={accInitialBalance} onChange={e=>setAccInitialBalance(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Currency</label>
                       <select value={accCurrency} onChange={e=>setAccCurrency(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white">
                           {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}
                       </select>
                   </div>
                   <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Sub-Type</label>
                       <select value={accSubType} onChange={e=>setAccSubType(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white">
                           <option value="">Standard</option>
                           {availableSubTypes.map(s => <option key={s} value={s}>{s}</option>)}
                           <option value="Other">+ Add Custom...</option>
                       </select>
                   </div>
                   {accSubType === 'Other' && (
                       <div>
                           <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">New Sub-Type Name</label>
                           <input type="text" value={newCustomSubType} onChange={e=>setNewCustomSubType(e.target.value)} placeholder="e.g. Crypto" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                       </div>
                   )}
               </div>

               {accType === 'credit' && (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 p-6 bg-slate-50 rounded-2xl border border-slate-100 animate-fade-in">
                       <div>
                           <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 text-brand-600">Credit Limit</label>
                           <input type="number" value={accCreditLimit} onChange={e=>setAccCreditLimit(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                       </div>
                       <div>
                           <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 text-brand-600">Payment Day (1-31)</label>
                           <input type="number" value={accPaymentDay} onChange={e=>setAccPaymentDay(e.target.value)} placeholder="10" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                       </div>
                       <div>
                           <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 text-brand-600">Withdraw From</label>
                           <select value={accPayFromId} onChange={e=>setAccPayFromId(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white outline-none">
                               <option value="">Select Account...</option>
                               {accounts.filter(a => a.type === 'checking' && a.id !== isEditingAccount).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                           </select>
                       </div>
                   </div>
               )}

               {IS_ASSET_CLASS(accType) && (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 p-6 bg-brand-50/50 rounded-2xl border border-brand-100 animate-fade-in">
                       <div className="md:col-span-1">
                           <label className="block text-[10px] font-black text-brand-600 uppercase tracking-widest mb-1.5 ml-1">Investment Track</label>
                           <input type="text" value={accInvestmentTrack} onChange={e=>setAccInvestmentTrack(e.target.value)} placeholder="e.g. S&P 500" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                       </div>
                       {accType === 'pension' && (
                           <div>
                               <label className="block text-[10px] font-black text-brand-600 uppercase tracking-widest mb-1.5 ml-1">Estimated Pension</label>
                               <input type="number" value={accEstimatedPension} onChange={e=>setAccEstimatedPension(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                           </div>
                       )}
                       <div>
                           <label className="block text-[10px] font-black text-brand-600 uppercase tracking-widest mb-1.5 ml-1">Yield / Interest %</label>
                           <input type="number" value={accInterestRate} onChange={e=>setAccInterestRate(e.target.value)} placeholder="4.5" className="w-full p-3 border rounded-xl text-sm font-bold outline-none"/>
                       </div>
                   </div>
               )}

               <div className="mt-8 pt-8 border-t border-slate-50 flex gap-4">
                   <button onClick={handleSaveAccount} disabled={isSaving} className="px-10 py-3 bg-brand-600 text-white rounded-2xl text-sm font-black shadow-xl hover:bg-brand-700 transition-all flex items-center gap-2">
                       {isSaving ? <Loader size={18} className="animate-spin" /> : <Save size={18}/>} {isEditingAccount ? 'Update Account' : 'Register Account'}
                   </button>
                   {isEditingAccount && <button onClick={resetAccountForm} className="px-10 py-3 bg-slate-100 text-slate-600 rounded-2xl text-sm font-black transition-all">Cancel</button>}
               </div>
           </div>

           {/* ACCOUNT CARDS GRID */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortAccounts(accounts).map(acc => (
                  <div key={acc.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col justify-between group hover:border-brand-200 transition-all relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: acc.color }}></div>
                      <div className="flex justify-between items-start mb-4">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg" style={{ backgroundColor: acc.color }}>{acc.name.charAt(0)}</div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditAccount(acc)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"><Edit2 size={16}/></button>
                              <button onClick={() => confirm("Delete account?") && onDeleteAccount(acc.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={16}/></button>
                          </div>
                      </div>
                      <div>
                          <h4 className="font-black text-slate-800 text-lg leading-tight truncate">{acc.name}</h4>
                          <div className="flex flex-wrap gap-1.5 mt-3">
                              <span className="text-[8px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-black uppercase tracking-widest">{acc.type}</span>
                              {acc.subType && <span className="text-[8px] px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded font-black uppercase tracking-widest">{acc.subType}</span>}
                              {acc.owner && <span className="text-[8px] px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded font-black uppercase tracking-widest">{acc.owner}</span>}
                          </div>
                      </div>
                  </div>
              ))}
           </div>
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-black text-xl mb-6 flex items-center gap-3"><Tag className="text-brand-500"/>Expense Categories</h3>
            <div className="flex gap-3">
              <input type="text" placeholder="Add new category..." value={newCategory} onChange={e => setNewCategory(e.target.value)} className="flex-1 p-3 border rounded-xl text-sm font-bold outline-none focus:ring-4 focus:ring-brand-500/10 transition-all" />
              <button onClick={handleAddCategory} className="px-8 py-3 bg-brand-600 text-white rounded-xl text-sm font-black flex items-center gap-2 shadow-lg active:scale-95 transition-all">Add Category</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {categories.map(cat => (
              <div key={cat} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between group hover:border-brand-300 transition-all min-h-[100px]">
                {editingCategory === cat ? (
                    <div className="space-y-2">
                        <input value={editedCategoryName} onChange={e=>setEditedCategoryName(e.target.value)} className="w-full p-2 border rounded-lg text-xs font-bold" autoFocus />
                        <div className="flex gap-2">
                            <button onClick={saveRenamedCategory} className="flex-1 bg-green-500 text-white py-1 rounded text-[10px] font-black">Save</button>
                            <button onClick={() => setEditingCategory(null)} className="flex-1 bg-slate-100 text-slate-500 py-1 rounded text-[10px] font-black">X</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <span className="text-sm font-black text-gray-700 leading-tight">{cat}</span>
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingCategory(cat); setEditedCategoryName(cat); }} className="p-1.5 text-slate-400 hover:text-brand-600"><Edit2 size={12}/></button>
                            <button onClick={() => confirm(`Delete "${cat}"?`) && onDeleteCategory(cat)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={12}/></button>
                        </div>
                    </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
          <div className="space-y-8">
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-black text-xl mb-8 flex items-center gap-3 text-slate-800"><Zap className="text-brand-500"/>Auto-Categorization Rules</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">If Payee Contains</label>
                          <input type="text" value={rulePattern} onChange={e=>setRulePattern(e.target.value)} placeholder="e.g. Netflix" className="w-full p-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand-500"/>
                      </div>
                      <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Then Assign Category</label>
                          <select value={ruleCategory} onChange={e=>setRuleCategory(e.target.value)} className="w-full p-3 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500">
                              {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                      </div>
                      <div className="flex items-end">
                          <button onClick={handleSaveRule} disabled={isSaving} className="w-full px-8 py-3 bg-brand-600 text-white rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95">
                              {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16}/>} {isEditingRule ? 'Update Rule' : 'Save Rule'}
                          </button>
                      </div>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {rules.map(rule => (
                      <div key={rule.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group hover:border-brand-300 transition-all">
                          <div className="flex items-center gap-4">
                              <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl"><Zap size={20}/></div>
                              <div>
                                  <div className="text-sm font-black text-slate-800">If payee contains "{rule.payeePattern}"</div>
                                  <div className="text-[10px] font-bold text-brand-600 uppercase tracking-widest">Assign to: {rule.category}</div>
                              </div>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setIsEditingRule(rule.id); setRulePattern(rule.payeePattern); setRuleCategory(rule.category); }} className="p-2 text-slate-400 hover:text-brand-600 transition-all"><Edit2 size={16}/></button>
                              <button onClick={() => onDeleteRule(rule.id)} className="p-2 text-slate-400 hover:text-red-500 transition-all"><Trash2 size={16}/></button>
                          </div>
                      </div>
                  ))}
                  {rules.length === 0 && <div className="col-span-full py-16 text-center text-slate-400 font-bold italic bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-100">No automated rules defined yet.</div>}
              </div>
          </div>
      )}

      {activeTab === 'db' && (
        <div className="space-y-6">
            <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl space-y-8">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Server size={28}/></div>
                        <div>
                            <h3 className="text-xl font-black">Supabase Infrastructure</h3>
                            <p className="text-xs text-slate-400 font-medium tracking-tight">Cloud Instance Status & Maintenance</p>
                        </div>
                    </div>
                    <button onClick={handleTestConnection} disabled={isTestingConnection} className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 rounded-2xl text-xs font-black uppercase transition-all shadow-lg active:scale-95">
                        <Activity size={16} className={isTestingConnection ? 'animate-spin' : ''}/> Test Connection
                    </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { label: 'Cloud Endpoint', value: debugInfo.hasUrl ? 'CONNECTED' : 'MISSING', ok: debugInfo.hasUrl },
                        { label: 'Session Token', value: debugInfo.hasKey ? 'INJECTED' : 'MISSING', ok: debugInfo.hasKey },
                        { label: 'AI Engine', value: getApiKey() ? 'ACTIVE' : 'KEY MISSING', ok: !!getApiKey() }
                    ].map(item => (
                        <div key={item.label} className="p-5 bg-slate-800 rounded-2xl border border-slate-700 shadow-inner">
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{item.label}</p>
                            <div className="text-sm font-black flex items-center gap-2">
                               {item.ok ? <CheckCircle2 size={16} className="text-green-500"/> : <XCircle size={16} className="text-red-500"/>}
                               <span>{item.value}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="pt-8 border-t border-slate-800">
                    <div className="flex justify-between items-center mb-6">
                       <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Table Schema Health Registry</h4>
                       <button onClick={refreshHealth} disabled={isCheckingHealth} className="text-[10px] font-black text-brand-400 hover:text-brand-300 flex items-center gap-2 uppercase">
                          <RefreshCw size={12} className={isCheckingHealth ? 'animate-spin' : ''}/> Re-Scan Tables
                       </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {Object.entries(tableHealth).map(([table, ok]) => (
                            <div key={table} className={`p-3 rounded-xl border text-[9px] font-black uppercase flex items-center justify-between transition-all ${ok ? 'bg-green-500/5 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400 shadow-lg shadow-red-500/10'}`}>
                                <span>{table}</span>
                                {ok ? <Check size={12}/> : <X size={12}/>}
                            </div>
                        ))}
                    </div>
                </div>

                {hasSchemaError && (
                    <div className="mt-8 p-8 bg-red-600 text-white rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12"><HardDrive size={100}/></div>
                        <div className="relative z-10 space-y-4">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="text-red-200" size={32}/>
                                <h4 className="text-xl font-black uppercase">Infrastructure Repair Required</h4>
                            </div>
                            <p className="text-sm font-medium text-red-100 max-w-xl">Missing core tables detected. Copy the repair script below and execute it in your Supabase SQL Editor to restore database integrity.</p>
                            <button onClick={copySql} className="bg-white text-red-600 hover:bg-red-50 px-8 py-3 rounded-2xl text-xs font-black uppercase flex items-center gap-2 shadow-xl transition-all active:scale-95"><Copy size={16}/> Copy Repair SQL</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm text-center space-y-12">
            <div className="grid md:grid-cols-2 gap-8">
                <button onClick={handleExportData} className="p-12 border-2 border-slate-50 rounded-[3rem] hover:bg-slate-50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                    <div className="p-6 bg-brand-50 text-brand-600 rounded-[2rem] group-hover:scale-110 transition-transform"><Download size={48}/></div>
                    <div>
                        <div className="font-black text-2xl text-slate-800">Export Records</div>
                        <div className="text-slate-400 text-sm mt-1 font-medium">Download local JSON archive</div>
                    </div>
                </button>
                <div className="relative">
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="w-full p-12 border-2 border-green-50 rounded-[3rem] hover:bg-green-50/50 transition-all text-left flex items-center gap-8 group shadow-sm hover:shadow-md">
                        <div className="p-6 bg-green-50 text-green-600 rounded-[2rem] group-hover:scale-110 transition-transform"><Upload size={48}/></div>
                        <div>
                            <div className="font-black text-2xl text-slate-800">Restore Backup</div>
                            <div className="text-slate-400 text-sm mt-1 font-medium">Overwrites cloud with local file</div>
                        </div>
                    </button>
                </div>
            </div>
            <div className="bg-slate-900 p-10 rounded-[3rem] text-white flex flex-col md:flex-row items-center justify-between gap-8 border-4 border-slate-800">
                <div className="flex items-center gap-6">
                    <div className="p-5 bg-white/10 rounded-2xl"><UserMinus size={40} className="text-red-400"/></div>
                    <div className="text-left">
                        <h4 className="font-black text-xl">Factory Data Reset</h4>
                        <p className="text-xs text-slate-400 font-medium max-w-sm mt-1">Irreversibly wipe all financial records from the cloud. Use with extreme caution.</p>
                    </div>
                </div>
                <button onClick={() => confirm("WARNING: This will permanently delete all cloud records. Continue?") && clearAllUserData().then(() => window.location.reload())} className="px-10 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-sm font-black transition-all shadow-xl shadow-red-500/20 active:scale-95">Purge Cloud Data</button>
            </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100">
            <div className="p-10 border-b flex justify-between items-center bg-gray-50/50">
              <h3 className="text-2xl font-black text-slate-900 flex items-center gap-3">Import Data Verification</h3>
              <button onClick={() => setShowRestoreModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"><X size={24}/></button>
            </div>
            <div className="p-12 text-center space-y-8">
                <div className="p-8 bg-red-50 rounded-[2.5rem] text-red-600 border border-red-100 flex flex-col items-center">
                    <AlertTriangle size={64} className="mb-4 animate-bounce"/>
                    <p className="font-black text-2xl uppercase tracking-tight">Security Override Warning</p>
                    <p className="text-sm font-bold mt-3 leading-relaxed">Proceeding will IRREVERSIBLY ERASE all your current cloud data and replace it with the records from the uploaded backup file.</p>
                </div>
                <button onClick={performRestore} className="w-full bg-slate-900 hover:bg-black text-white px-10 py-6 rounded-[2rem] font-black shadow-2xl transition-all active:scale-95 text-xl tracking-tight">INITIATE CLOUD OVERWRITE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
