
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Account, Transaction, RecurringTransaction, SmartCategoryBudget, Valuation } from '../types';
import { CURRENCIES, formatCurrency } from '../utils/currency';
import { Plus, Trash2, Edit2, Check, X, Wallet, Tag, Info, AlertOctagon, RefreshCw, Calendar, ArrowRightLeft, Download, Upload, Database, Save, Play, UserMinus, Loader, AlertTriangle, ListFilter, User, Terminal, Copy, FileJson, CheckCircle2, SearchCode, LifeBuoy, Zap } from 'lucide-react';
import { clearAllUserData, fetchAccountSubTypes, createAccountSubType, fetchCategoryBudgets, fetchValuations, batchCreateCategoryBudgets } from '../services/storageService';
import { initSupabase } from '../services/supabaseClient';
import { sortAccounts } from '../utils/finance';

interface SettingsProps {
  accounts: Account[];
  categories: string[];
  transactions?: Transaction[];
  recurring?: RecurringTransaction[];
  
  onSaveAccount: (acc: Account) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onUpdateCategories: (categories: string[]) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onRestoreData: (data: any) => Promise<void>;
  onRunAutoProcess?: () => void;
}

const IS_ASSET_CLASS = (type: string) => ['savings', 'pension', 'investment'].includes(type);

export const Settings: React.FC<SettingsProps> = ({ 
  accounts, categories, transactions = [], recurring = [],
  onSaveAccount, onDeleteAccount, onUpdateCategories, onRenameCategory, onRestoreData, onRunAutoProcess
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'categories' | 'data'>('accounts');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  
  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreStage, setRestoreStage] = useState<'upload' | 'summary'>('upload');
  const [restorePayload, setRestorePayload] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Recovery tool
  const [showLegacyTool, setShowLegacyTool] = useState(false);
  const [legacyJson, setLegacyJson] = useState('');
  const [rescueResults, setRescueResults] = useState<SmartCategoryBudget[]>([]);

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
  
  // Custom Sub-types
  const [availableSubTypes, setAvailableSubTypes] = useState<string[]>([]);
  const [newCustomSubType, setNewCustomSubType] = useState('');
  const [accInvestmentTrack, setAccInvestmentTrack] = useState('');
  const [accEstimatedPension, setAccEstimatedPension] = useState('');
  
  // Category Form
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { loadSubTypes(); }, []);
  const loadSubTypes = async () => { const subs = await fetchAccountSubTypes(); setAvailableSubTypes(subs); };
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
            estimatedPension: parseFloat(accEstimatedPension) || undefined 
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
  };

  const handleDeleteAccount = (id: string) => { if (confirm("Delete this account and all its transactions?")) onDeleteAccount(id); };
  
  const resetAccountForm = () => { 
    setAccName(''); 
    setAccOwner(''); 
    setAccCurrency('ILS'); 
    setAccType('checking'); 
    setAccSubType(''); 
    setNewCustomSubType(''); 
    setAccInitialBalance(''); 
    setAccCreditLimit(''); 
    setAccPaymentDay(''); 
    setAccPayFromId(''); 
    setAccInvestmentTrack(''); 
    setAccEstimatedPension(''); 
    setIsEditingAccount(null); 
  };

  const handleExportData = async () => {
    const [budgets, vals, subs] = await Promise.all([fetchCategoryBudgets(), fetchValuations(), fetchAccountSubTypes()]);
    const exportData = { 
        accounts, 
        transactions, 
        recurring, 
        categories, 
        categoryBudgets: budgets, 
        valuations: vals, 
        accountSubTypes: subs, 
        backend: 'supabase',
        timestamp: new Date().toISOString() 
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `financeflow_supabase_backup_${dateStr}.json`;
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

  const handleRescueManual = () => {
      try {
          const data = JSON.parse(legacyJson);
          const found: SmartCategoryBudget[] = [];
          const seen = new Set();
          const search = (obj: any) => {
              if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
              seen.add(obj);
              if (Array.isArray(obj)) {
                  obj.forEach(item => {
                      if (item && typeof item === 'object') {
                          const k = Object.keys(item).map(x => x.toLowerCase());
                          const isBudget = (k.some(x => x.includes('cat')) || k.some(x => x.includes('name'))) && 
                                           (k.some(x => x.includes('limit')) || k.some(x => x.includes('budget')) || k.some(x => x === 'amount'));
                          if (isBudget && !k.includes('date')) {
                              const catKey = Object.keys(item).find(x => x.toLowerCase().includes('cat') || x.toLowerCase() === 'name')!;
                              const limitKey = Object.keys(item).find(x => x.toLowerCase().includes('limit') || x.toLowerCase().includes('budget') || x.toLowerCase() === 'amount')!;
                              found.push({
                                  id: item.id || crypto.randomUUID(),
                                  categoryName: String(item[catKey]),
                                  monthlyLimit: Number(item[limitKey]),
                                  useAverage: !!(item.useAverage || item.use_average),
                                  isActive: true
                              });
                          }
                      }
                      search(item);
                  });
              } else { Object.values(obj).forEach(search); }
          };
          search(data);
          setRescueResults(found);
          if (found.length === 0) alert("No budget patterns detected in this text.");
      } catch (e) { alert("Invalid JSON text. Please paste the raw content of the file."); }
  };

  const commitRescuedBudgets = async () => {
      if (rescueResults.length === 0) return;
      setIsSaving(true);
      try {
          await batchCreateCategoryBudgets(rescueResults);
          alert(`Success! ${rescueResults.length} Spend Limits imported into cloud.`);
          window.location.reload();
      } finally { setIsSaving(false); }
  };

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      onUpdateCategories([...categories, newCategory.trim()].sort());
      setNewCategory('');
    }
  };

  const handleStartRename = (cat: string) => {
    setEditingCategory(cat);
    setEditedCategoryName(cat);
  };

  const handleSaveRename = () => {
    if (editingCategory && editedCategoryName.trim() && editingCategory !== editedCategoryName.trim()) {
      onRenameCategory(editingCategory, editedCategoryName.trim());
    }
    setEditingCategory(null);
  };

  const handleDeleteCategory = (cat: string) => {
    if (confirm(`Are you sure you want to delete category "${cat}"? This will not delete transactions, but they will become uncategorized.`)) {
      onUpdateCategories(categories.filter(c => c !== cat));
    }
  };

  const performRestore = async () => {
    if (!restorePayload) return;
    setIsSaving(true);
    try {
      await onRestoreData(restorePayload);
      setShowRestoreModal(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
      <div className="flex space-x-4 border-b border-gray-200 overflow-x-auto">
        <button onClick={() => setActiveTab('accounts')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'accounts' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Accounts</button>
        <button onClick={() => setActiveTab('categories')} className={`pb-2 px-4 font-medium transition-colors border-b-2 ${activeTab === 'categories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Categories</button>
        <button onClick={() => setActiveTab('data')} className={`pb-2 px-4 font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'data' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Database size={16} /> Data</button>
      </div>
      
      {activeTab === 'accounts' && (
        <div className="space-y-6">
           <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
               <h3 className="font-bold text-lg mb-4">{isEditingAccount ? 'Edit' : 'Add'} Account</h3>
               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                   <div className="md:col-span-1"><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Account Name</label><input type="text" value={accName} onChange={e=>setAccName(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   <div className="md:col-span-1"><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Owner</label><input type="text" value={accOwner} onChange={e=>setAccOwner(e.target.value)} placeholder="e.g. Joint, Private" className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Currency</label><select value={accCurrency} onChange={e=>setAccCurrency(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none">{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Account Type</label><select value={accType} onChange={e=>setAccType(e.target.value as any)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none"><option value="checking">Checking (עו"ש)</option><option value="credit">Credit Card</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="investment">Investment</option><option value="pension">Pension</option></select></div>
                   
                   <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Initial Balance</label><input type="number" value={accInitialBalance} onChange={e=>setAccInitialBalance(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                   
                   {accType === 'credit' && (
                     <>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Credit Limit</label><input type="number" value={accCreditLimit} onChange={e=>setAccCreditLimit(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Payment Day (1-31)</label><input type="number" min="1" max="31" value={accPaymentDay} onChange={e=>setAccPaymentDay(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Pay From Account</label><select value={accPayFromId} onChange={e=>setAccPayFromId(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none"><option value="">Manual Pay</option>{accounts.filter(a=>a.type==='checking' && a.id !== isEditingAccount).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                     </>
                   )}

                   {IS_ASSET_CLASS(accType) && (
                     <>
                       <div>
                         <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Sub-Type</label>
                         <select value={accSubType} onChange={e=>setAccSubType(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-brand-500 outline-none">
                            <option value="">None</option>
                            {availableSubTypes.map(s => <option key={s} value={s}>{s}</option>)}
                            <option value="Other">+ New...</option>
                         </select>
                         {accSubType === 'Other' && <input type="text" placeholder="Custom Sub-type" value={newCustomSubType} onChange={e=>setNewCustomSubType(e.target.value)} className="mt-2 w-full p-2.5 border rounded-xl text-sm font-bold" />}
                       </div>
                       <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Investment Track</label><input type="text" value={accInvestmentTrack} onChange={e=>setAccInvestmentTrack(e.target.value)} placeholder="e.g. S&P 500" className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       {accType === 'pension' && (
                         <div><label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Est. Pension (Monthly)</label><input type="number" value={accEstimatedPension} onChange={e=>setAccEstimatedPension(e.target.value)} className="w-full p-2.5 border rounded-xl text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none"/></div>
                       )}
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
                               <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{acc.type}{acc.subType ? ` / ${acc.subType}` : ''}</div>
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

      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-lg mb-4">Manage Categories</h3>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="New category name..." 
                value={newCategory} 
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                className="flex-1 p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button onClick={handleAddCategory} className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium flex items-center gap-2">
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categories.map(cat => (
              <div key={cat} className="bg-white p-3 rounded-xl border border-gray-200 flex flex-col justify-between group hover:border-brand-300 transition-all">
                {editingCategory === cat ? (
                  <div className="space-y-2">
                    <input 
                      type="text" 
                      autoFocus
                      value={editedCategoryName} 
                      onChange={e => setEditedCategoryName(e.target.value)}
                      className="w-full p-1 border rounded text-xs"
                    />
                    <div className="flex gap-1">
                      <button onClick={handleSaveRename} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14}/></button>
                      <button onClick={() => setEditingCategory(null)} className="p-1 text-red-600 hover:bg-red-50 rounded"><X size={14}/></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-bold text-gray-700 truncate">{cat}</span>
                    <div className="flex justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleStartRename(cat)} className="p-1 text-gray-400 hover:text-blue-600"><Edit2 size={14}/></button>
                      <button onClick={() => handleDeleteCategory(cat)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 className="font-bold text-lg mb-6">Backup & Cloud Sync</h3>
                <div className="grid md:grid-cols-3 gap-4 mb-8">
                    <button onClick={handleExportData} className="p-6 border rounded-2xl hover:bg-slate-50 transition-all text-left flex items-center gap-4 group">
                        <div className="p-3 bg-brand-50 text-brand-600 rounded-xl group-hover:scale-110 transition-transform"><Download size={24}/></div>
                        <div><div className="font-bold">Export Cloud Data</div><div className="text-xs text-gray-400">Download .json backup</div></div>
                    </button>
                    <button onClick={() => { setRestoreStage('upload'); setShowRestoreModal(true); }} className="p-6 border rounded-2xl hover:bg-slate-50 transition-all text-left flex items-center gap-4 group">
                        <div className="p-3 bg-green-50 text-green-600 rounded-xl group-hover:scale-110 transition-transform"><Upload size={24}/></div>
                        <div><div className="font-bold">Import Backup File</div><div className="text-xs text-gray-400">Upload .json backup</div></div>
                    </button>
                    <button onClick={() => setShowLegacyTool(true)} className="p-6 border border-orange-200 bg-orange-50/10 rounded-2xl hover:bg-orange-50 transition-all text-left flex items-center gap-4 group">
                        <div className="p-3 bg-orange-100 text-orange-600 rounded-xl group-hover:rotate-12 transition-transform"><Zap size={24}/></div>
                        <div><div className="font-bold">Legacy Recovery</div><div className="text-xs text-orange-400">Rescue missing budgets</div></div>
                    </button>
                </div>
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
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-4 border-dashed border-slate-100 rounded-[2rem] p-12 hover:border-brand-200 hover:bg-brand-50 transition-all cursor-pointer group"
                  >
                    <Upload size={48} className="mx-auto text-slate-200 group-hover:text-brand-400 mb-4" />
                    <p className="font-black text-slate-400 group-hover:text-brand-600 uppercase tracking-widest">Select Backup JSON File</p>
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                  </div>
                  <p className="text-xs text-slate-400 font-medium">Your current cloud data will be replaced by the contents of the backup.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Accounts</p>
                      <p className="text-2xl font-black">{restorePayload?.accounts?.length || 0}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Transactions</p>
                      <p className="text-2xl font-black">{restorePayload?.transactions?.length || 0}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Commitments</p>
                      <p className="text-2xl font-black">{restorePayload?.recurring?.length || 0}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Spend Limits</p>
                      <p className="text-2xl font-black">{restorePayload?.categoryBudgets?.length || 0}</p>
                    </div>
                  </div>

                  <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl flex gap-4">
                    <AlertTriangle className="text-orange-600 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-black text-orange-900 text-sm uppercase tracking-tight">Warning: Irreversible Action</p>
                      <p className="text-orange-800 text-xs font-medium">Clicking restore will delete all current data in your cloud account and replace it with the items listed above.</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setRestoreStage('upload')} className="flex-1 px-6 py-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-black text-slate-600 text-sm uppercase tracking-widest">Back</button>
                    <button onClick={performRestore} disabled={isSaving} className="flex-[2] px-6 py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-black shadow-xl shadow-brand-500/20 text-sm uppercase tracking-widest flex items-center justify-center gap-2">
                      {isSaving ? <Loader className="animate-spin"/> : 'Wipe & Restore Now'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Legacy Recovery Tool Modal */}
      {showLegacyTool && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
              <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in">
                  <div className="p-8 border-b flex justify-between items-center bg-orange-50/30">
                      <div><h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Zap className="text-orange-500"/> Legacy Data Rescue</h3><p className="text-xs text-slate-500 font-bold uppercase mt-1">Extract missing Spend Limits from raw JSON</p></div>
                      <button onClick={() => setShowLegacyTool(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
                  </div>
                  <div className="flex-1 overflow-auto p-8 space-y-6">
                      <div className="space-y-2">
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Paste Raw Backup File Text Here</label>
                          <textarea 
                             value={legacyJson}
                             onChange={e => setLegacyJson(e.target.value)}
                             placeholder='{"accounts": [...], "budgets": [...]}'
                             className="w-full h-48 p-4 bg-slate-900 text-brand-400 font-mono text-xs rounded-2xl border border-slate-700 outline-none focus:ring-4 focus:ring-brand-500/20"
                          />
                      </div>
                      <button onClick={handleRescueManual} className="w-full bg-slate-800 text-white p-4 rounded-2xl font-black shadow-xl hover:bg-slate-700 transition-all">Analyze Text for Budgets</button>
                      
                      {rescueResults.length > 0 && (
                          <div className="animate-slide-up space-y-4 pt-6 border-t">
                              <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-center justify-between">
                                  <div className="flex items-center gap-3"><CheckCircle2 className="text-green-600"/><span className="font-bold text-green-900">Detected {rescueResults.length} potential Spend Limits!</span></div>
                                  <button onClick={commitRescuedBudgets} disabled={isSaving} className="bg-brand-600 text-white px-6 py-2 rounded-xl font-black text-xs shadow-md">Restore These Now</button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                  {rescueResults.map((r, i) => (
                                      <div key={i} className="p-3 bg-slate-50 border rounded-xl text-xs flex justify-between items-center"><span className="font-bold text-slate-700">{r.categoryName}</span><span className="font-black text-brand-600">{formatCurrency(r.monthlyLimit)}</span></div>
                                  ))}
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
