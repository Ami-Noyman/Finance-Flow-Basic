
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TransactionList } from './components/TransactionList';
import { RecurringManager } from './components/RecurringManager';
import { ForecastView } from './components/ForecastView';
import { GoalsManager } from './components/GoalsManager';
import { Settings } from './components/Settings';
import { AssetClassDashboard } from './components/AssetClassDashboard';
import { Auth } from './components/Auth';
import { HelpPanel } from './components/HelpPanel';
import { Transaction, RecurringTransaction, Account, TransactionType, Frequency, AmountType, SmartCategoryBudget, Valuation, FinancialGoal, TransactionRule } from './types';
import { 
  fetchTransactions, createAccount as saveAccountToDb, batchCreateAccounts, updateAccountsLinks, fetchAccounts, fetchRecurring, createRecurring, batchCreateRecurring, fetchCategories, createCategory, batchCreateCategories, deleteAccount as deleteAccountFromDb, deleteRecurring, deleteTransaction as deleteTx, clearAllUserData, batchCreateTransactions,
  fetchCategoryBudgets, batchCreateCategoryBudgets, saveCategoryBudget, deleteCategoryBudget, createTransaction, fetchValuations, batchCreateValuations, saveValuation, deleteValuation, createAccountSubType, batchCreateAccountSubTypes,
  fetchGoals, saveGoal, deleteGoal, batchCreateGoals, fetchRules, saveRule, deleteRule
} from './services/storageService';
import { initSupabase, isConfigured } from './services/supabaseClient';
import { ChevronDown, PiggyBank, ShieldCheck, LogOut, HelpCircle, Loader, CreditCard, Target } from 'lucide-react';
import { calculateNextDate, getSmartAmount, sortAccounts } from './utils/finance';
import { parseISO, format, startOfDay, isBefore, isSameDay } from 'date-fns';
import { Chat } from "@google/genai";

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSetup, setIsSetup] = useState(isConfigured());
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restorationProgress, setRestorationProgress] = useState('');

  // Data State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<SmartCategoryBudget[]>([]);
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [rules, setRules] = useState<TransactionRule[]>([]);
  
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const chatSessionRef = useRef<Chat | null>(null);

  const [isLoading, setIsLoading] = useState(true); 
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [financialInsight, setFinancialInsight] = useState<string | null>(null);
  
  const hasProcessedRef = useRef(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleTabChange = (e: any) => {
        if (e.detail) setActiveTab(e.detail);
    };
    window.addEventListener('changeTab', handleTabChange);
    return () => window.removeEventListener('changeTab', handleTabChange);
  }, []);

  useEffect(() => {
    const supabase = initSupabase();
    if (!supabase) { setIsLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      setSession(session);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: any) => setSession(session));
    return () => subscription.unsubscribe();
  }, [isSetup]);

  useEffect(() => { 
    if (session?.user) loadData(); 
    else {
      setTransactions([]); setRecurring([]); setAccounts([]); setCategories([]); setCategoryBudgets([]); setValuations([]); setGoals([]); setRules([]);
      setFinancialInsight(null); setChatMessages([]); chatSessionRef.current = null; hasProcessedRef.current = false;
    }
  }, [session]);

  const loadData = async () => {
    if (!session?.user) return;
    try {
      const uid = session.user.id;
      const [accs, txs, recs, budgets, vals, cats, gls, rls] = await Promise.all([
        fetchAccounts(uid), fetchTransactions(uid), fetchRecurring(uid),
        fetchCategoryBudgets(uid), fetchValuations(uid), fetchCategories(uid), fetchGoals(uid), fetchRules(uid)
      ]);
      setAccounts(sortAccounts(accs || [])); setTransactions(txs || []); setRecurring(recs || []);
      setCategories(cats || []); setCategoryBudgets(budgets || []); setValuations(vals || []); setGoals(gls || []); setRules(rls || []);
    } catch (e: any) { console.error("Error loading data:", e); }
  };

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const handleLogout = async () => {
    const supabase = initSupabase();
    if(supabase) await supabase.auth.signOut();
    
    // Explicitly clear session-based alert dismissals on logout
    sessionStorage.removeItem('financeflow_dismissed_alerts');
    
    setSession(null);
  };

  const handleSaveGoal = async (g: FinancialGoal) => {
    setGoals(prev => {
        const exists = prev.some(item => item.id === g.id);
        return exists ? prev.map(item => item.id === g.id ? g : item) : [...prev, g];
    });
    try { await saveGoal(g); } catch (e) { console.error(e); }
  };

  const handleDeleteGoal = async (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
    try { await deleteGoal(id); } catch (e) { console.error(e); }
  };

  const handleSaveRule = async (r: TransactionRule) => {
      setRules(prev => prev.some(item => item.id === r.id) ? prev.map(item => item.id === r.id ? r : item) : [...prev, r]);
      try { await saveRule(r); } catch (e) { console.error(e); }
  };

  const handleDeleteRule = async (id: string) => {
      setRules(prev => prev.filter(r => r.id !== id));
      try { await deleteRule(id); } catch (e) { console.error(e); }
  };

  const handleSaveAccount = async (acc: Account) => { setAccounts(prev => sortAccounts(prev.some(a => a.id === acc.id) ? prev.map(a => a.id === acc.id ? acc : a) : [...prev, acc])); try { await saveAccountToDb(acc); } catch (e) { console.error(e); } };
  const handleDeleteAccount = async (id: string) => { if (accounts.length <= 1) return alert("Min 1 account required."); setAccounts(prev => prev.filter(a => a.id !== id)); try { await deleteAccountFromDb(id); } catch (e) { console.error(e); } };
  const handleAddTransaction = async (newTx: Transaction) => { setTransactions(prev => [newTx, ...prev]); try { await createTransaction(newTx); } catch (e) { console.error(e); } };
  const handleEditTransaction = async (tx: Transaction) => { setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t)); try { await createTransaction(tx); } catch (e) { console.error(e); } };
  const handleDeleteTransaction = async (id: string) => { setTransactions(prev => prev.filter(t => t.id !== id)); try { await deleteTx(id); } catch (e) { console.error(e); } };
  const handleAddRecurring = async (r: RecurringTransaction) => { setRecurring(prev => [...prev, r]); try { await createRecurring(r); } catch (e) { console.error(e); } };
  const handleEditRecurring = async (r: RecurringTransaction) => { setRecurring(prev => prev.map(item => item.id === r.id ? r : item)); try { await createRecurring(r); } catch (e) { console.error(e); } };
  const handleDeleteRecurring = async (id: string) => { setRecurring(prev => prev.filter(r => r.id !== id)); try { await deleteRecurring(id); } catch (e) { console.error(e); } };
  const handleSaveCategoryBudget = async (b: SmartCategoryBudget) => { setCategoryBudgets(prev => prev.some(item => item.id === b.id) ? prev.map(item => item.id === b.id ? b : item) : [...prev, b]); try { await saveCategoryBudget(b); } catch (e) { console.error(e); } };
  const handleDeleteCategoryBudget = async (id: string) => { setCategoryBudgets(prev => prev.filter(b => b.id !== id)); try { await deleteCategoryBudget(id); } catch (e) { console.error(e); } };
  const handleSaveValuation = async (v: Valuation) => { setValuations(prev => prev.some(item => item.id === v.id) ? prev.map(item => item.id === v.id ? v : item) : [...prev, v]); try { await saveValuation(v); } catch (e) { console.error(e); } };
  const handleDeleteValuation = async (id: string) => { setValuations(prev => prev.filter(v => v.id !== id)); try { await deleteValuation(id); } catch (e) { console.error(e); } };

  const handleRestoreData = async (data: any) => {
    setIsRestoring(true);
    setRestorationProgress('Preparing synchronization...');
    try {
      if (!data.accounts || !Array.isArray(data.accounts)) throw new Error("Invalid backup file: Missing 'accounts'.");
      
      const isUuid = (id: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
      const idMap = new Map<string, string>();
      
      setRestorationProgress('Updating IDs...');
      data.accounts = data.accounts.map((acc: any) => { if (!isUuid(acc.id)) { const newId = crypto.randomUUID(); idMap.set(acc.id, newId); return { ...acc, id: newId }; } return acc; });
      const updateLink = (id: string | undefined) => (id && idMap.has(id)) ? idMap.get(id) : id;
      
      data.accounts = data.accounts.map((acc: any) => ({ ...acc, payFromAccountId: updateLink(acc.payFromAccountId) }));
      if (data.transactions) data.transactions = data.transactions.map((tx: any) => ({ ...tx, id: isUuid(tx.id) ? tx.id : crypto.randomUUID(), accountId: updateLink(tx.accountId), toAccountId: updateLink(tx.toAccountId) }));
      if (data.recurring) data.recurring = data.recurring.map((rec: any) => ({ ...rec, id: isUuid(rec.id) ? rec.id : crypto.randomUUID(), accountId: updateLink(rec.accountId), toAccountId: updateLink(rec.toAccountId) }));
      if (data.valuations) data.valuations = data.valuations.map((val: any) => ({ ...val, id: isUuid(val.id) ? val.id : crypto.randomUUID(), accountId: updateLink(val.accountId) }));
      if (data.goals) data.goals = data.goals.map((gl: any) => ({ ...gl, id: isUuid(gl.id) ? gl.id : crypto.randomUUID(), accountId: updateLink(gl.accountId) }));
      if (data.rules) data.rules = data.rules.map((rl: any) => ({ ...rl, id: isUuid(rl.id) ? rl.id : crypto.randomUUID() }));

      setRestorationProgress('Clearing existing records...');
      await clearAllUserData();

      if (data.categories?.length) {
          setRestorationProgress('Uploading categories...');
          await batchCreateCategories(data.categories);
      }
      if (data.accountSubTypes?.length) {
          setRestorationProgress('Uploading account sub-types...');
          await batchCreateAccountSubTypes(data.accountSubTypes);
      }
      
      setRestorationProgress(`Uploading ${data.accounts.length} accounts...`);
      await batchCreateAccounts(data.accounts.map((a: any) => ({ ...a, payFromAccountId: undefined })));
      
      setRestorationProgress('Linking accounts...');
      await updateAccountsLinks(data.accounts);

      if (data.transactions?.length) {
          setRestorationProgress(`Uploading ${data.transactions.length} transactions...`);
          await batchCreateTransactions(data.transactions);
      }
      if (data.recurring?.length) {
          setRestorationProgress(`Uploading ${data.recurring.length} recurring rules...`);
          await batchCreateRecurring(data.recurring);
      }
      if (data.valuations?.length) {
          setRestorationProgress(`Uploading ${data.valuations.length} valuations...`);
          await batchCreateValuations(data.valuations);
      }
      if (data.goals?.length) {
          setRestorationProgress(`Uploading ${data.goals.length} goals...`);
          await batchCreateGoals(data.goals);
      }
      if (data.categoryBudgets?.length) {
          setRestorationProgress(`Uploading ${data.categoryBudgets.length} budgets...`);
          await batchCreateCategoryBudgets(data.categoryBudgets);
      }
      if (data.rules?.length) {
          setRestorationProgress(`Uploading ${data.rules.length} rules...`);
          for (const rule of data.rules) await saveRule(rule);
      }

      setRestorationProgress('Finalizing sync...');
      await loadData();
      alert(`SUCCESS: Data restored. Logged ${data.transactions?.length || 0} transactions across ${data.accounts.length} accounts.`);
    } catch (e: any) {
      console.error(e);
      alert(`RESTORE FAILED: ${e.message}. Check Database Health tab for missing tables.`);
    } finally {
      setIsRestoring(false);
      setRestorationProgress('');
    }
  };

  const renderContent = () => {
    const commonProps = { transactions, recurring, categoryBudgets, accounts: sortedAccounts, goals, selectedAccountId, valuations, rules };
    switch (activeTab) {
      case 'dashboard': return <Dashboard {...commonProps} />;
      case 'transactions': return <TransactionList {...commonProps} categories={categories} onAddTransaction={handleAddTransaction} onEditTransaction={handleEditTransaction} onDeleteTransaction={handleDeleteTransaction} onAddCategory={(c) => setCategories(prev => [...new Set([...prev, c])])} />;
      case 'recurring': return <RecurringManager {...commonProps} categories={categories} onAddRecurring={handleAddRecurring} onEditRecurring={handleEditRecurring} onDeleteRecurring={handleDeleteRecurring} onSaveCategoryBudget={handleSaveCategoryBudget} onDeleteCategoryBudget={handleDeleteCategoryBudget} onAddCategory={(c) => setCategories(prev => [...new Set([...prev, c])])} />;
      case 'goals': return <GoalsManager goals={goals} accounts={sortedAccounts} onSaveGoal={handleSaveGoal} onDeleteGoal={handleDeleteGoal} />;
      case 'savings': return <AssetClassDashboard title="Savings" accountType="savings" icon={PiggyBank} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'pension': return <AssetClassDashboard title="Pension" accountType="pension" icon={ShieldCheck} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'liabilities': return <AssetClassDashboard title="Liabilities" accountType="loan" icon={CreditCard} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'forecast': return <ForecastView {...commonProps} insight={financialInsight} setInsight={setFinancialInsight} persistentChatMessages={chatMessages} onUpdateChatMessages={setChatMessages} chatSessionRef={chatSessionRef} />;
      case 'ai': return <ForecastView viewMode="ai" {...commonProps} insight={financialInsight} setInsight={setFinancialInsight} persistentChatMessages={chatMessages} onUpdateChatMessages={setChatMessages} chatSessionRef={chatSessionRef} />;
      case 'settings': return <Settings {...commonProps} categories={categories} onSaveAccount={handleSaveAccount} onDeleteAccount={handleDeleteAccount} onUpdateCategories={setCategories} onRenameCategory={() => {}} onRestoreData={handleRestoreData} onSaveRule={handleSaveRule} onDeleteRule={handleDeleteRule} />;
      default: return <Dashboard {...commonProps} />;
    }
  };

  if (isLoading) return <div className="flex h-screen w-screen items-center justify-center bg-gray-50 flex-col gap-4 text-orange-600"> <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin"></div> <div>Loading your flow...</div> </div>;
  if (!session) return <Auth onConfigured={() => setIsSetup(true)} />;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans text-gray-900 relative">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-orange-600 border-b border-orange-700 px-6 py-3 flex justify-between items-center shadow-sm z-10">
          <div className="flex items-center gap-2"> <h1 className="text-xl font-bold text-white capitalize">{activeTab}</h1> </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsHelpOpen(true)} className="p-2 text-white/80 hover:text-white"><HelpCircle size={20} /></button>
            <div className="relative group">
                <div className="flex items-center gap-2 cursor-pointer bg-orange-700 px-3 py-1.5 rounded-lg border border-orange-800 text-white text-sm font-medium">
                  {selectedAccountId ? accounts.find(a => a.id === selectedAccountId)?.name : 'All Accounts'} <ChevronDown size={16} />
                </div>
                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button onClick={() => setSelectedAccountId(null)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b">All Accounts</button>
                  {sortedAccounts.map(acc => ( <button key={acc.id} onClick={() => setSelectedAccountId(acc.id)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50"> {acc.name} </button> ))}
                </div>
            </div>
            <button onClick={handleLogout} className="text-white/80 hover:text-white"><LogOut size={18} /></button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 lg:p-8" ref={mainContentRef}>
          <div className="max-w-7xl mx-auto min-h-full"> {renderContent()} </div>
        </div>
      </main>
      <HelpPanel activeTab={activeTab} isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      {isRestoring && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center text-white gap-4">
            <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-xl font-black uppercase tracking-widest">Restoring Your Data...</div>
            <p className="text-slate-200 text-sm font-black animate-pulse">{restorationProgress}</p>
        </div>
      )}
    </div>
  );
};
export default App;
