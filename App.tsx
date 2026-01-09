
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
import { ChevronDown, PiggyBank, ShieldCheck, LogOut, HelpCircle, Loader, CreditCard, Target, TrendingUp } from 'lucide-react';
import { calculateNextDate, getSmartAmount, sortAccounts } from './utils/finance';
import { parseISO, format, startOfDay, isBefore, isSameDay } from 'date-fns';
import { Chat } from "@google/genai";

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSetup, setIsSetup] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restorationProgress, setRestorationProgress] = useState('');

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

  const mainContentRef = useRef<HTMLDivElement>(null);

  const processDueRecurring = async (currentRecurring: RecurringTransaction[], currentTransactions: Transaction[]) => {
    if (!currentRecurring.length || !session?.user) return;

    const today = startOfDay(new Date());
    const newTransactions: Transaction[] = [];
    const updatedRecurring: RecurringTransaction[] = [];

    const workingRecurring = JSON.parse(JSON.stringify(currentRecurring)) as RecurringTransaction[];

    for (let r of workingRecurring) {
      if (!r.isActive) continue;

      let nextDue = parseISO(r.nextDueDate);
      let processedCount = r.occurrencesProcessed || 0;
      let hasPostedForThisRule = false;

      while (isBefore(nextDue, today) || isSameDay(nextDue, today)) {
        if (r.totalOccurrences && processedCount >= r.totalOccurrences) {
          r.isActive = false;
          break;
        }

        const amount = getSmartAmount(r, nextDue, currentTransactions);
        const newTx: Transaction = {
          id: crypto.randomUUID(),
          date: format(nextDue, 'yyyy-MM-dd'),
          amount,
          payee: r.payee,
          category: r.category,
          type: r.type,
          accountId: r.accountId,
          toAccountId: r.toAccountId,
          isRecurring: true,
          recurringId: r.id,
          isReconciled: false
        };

        newTransactions.push(newTx);
        processedCount++;
        hasPostedForThisRule = true;

        nextDue = calculateNextDate(nextDue, r.frequency, r.customInterval, r.customUnit);

        r.nextDueDate = format(nextDue, 'yyyy-MM-dd');
        r.occurrencesProcessed = processedCount;

        if (r.totalOccurrences && processedCount >= r.totalOccurrences) {
          r.isActive = false;
          break;
        }
      }

      if (hasPostedForThisRule) {
        updatedRecurring.push(r);
      }
    }

    if (newTransactions.length > 0) {
      try {
        await batchCreateTransactions(newTransactions);
        for (const rec of updatedRecurring) {
          await createRecurring(rec);
        }

        setTransactions(prev => [...newTransactions, ...prev]);
        setRecurring(prev => prev.map(old => {
          const found = updatedRecurring.find(u => u.id === old.id);
          return found ? found : old;
        }));
      } catch (e) {
        console.error("[Recurring Engine] Error:", e);
      }
    }
  };

  useEffect(() => {
    const handleTabChange = (e: any) => {
      if (e.detail) {
        const [tab] = e.detail.split(':');
        setActiveTab(tab);
      }
    };
    window.addEventListener('changeTab', handleTabChange);
    return () => window.removeEventListener('changeTab', handleTabChange);
  }, []);

  useEffect(() => {
    const supabase = initSupabase();
    if (!supabase) { setIsLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session }, error }: any) => {
      if (error) {
        supabase.auth.signOut().then(() => { setSession(null); setIsLoading(false); });
        return;
      }
      setSession(session);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, [isSetup]);

  useEffect(() => {
    if (session?.user) {
      loadData().then(({ recurring: recs, transactions: txs }) => {
        processDueRecurring(recs, txs);
      });
    }
  }, [session]);

  const loadData = async () => {
    if (!session?.user) return { recurring: [], transactions: [] };
    try {
      const uid = session.user.id;
      const [accs, txs, recs, budgets, vals, cats, gls, rls] = await Promise.all([
        fetchAccounts(uid), fetchTransactions(uid), fetchRecurring(uid),
        fetchCategoryBudgets(uid), fetchValuations(uid), fetchCategories(uid), fetchGoals(uid), fetchRules(uid)
      ]);
      const sortedAccs = sortAccounts(accs || []);
      setAccounts(sortedAccs);
      setTransactions(txs || []);
      setRecurring(recs || []);
      setCategories(cats || []);
      setCategoryBudgets(budgets || []);
      setValuations(vals || []);
      setGoals(gls || []);
      setRules(rls || []);
      return { recurring: recs || [], transactions: txs || [] };
    } catch (e: any) {
      console.error("Error loading data:", e);
      return { recurring: [], transactions: [] };
    }
  };

  const handleRenameCategory = async (oldName: string, newName: string) => {
    const supabase = initSupabase();
    if (!supabase || !session?.user) return;
    const uid = session.user.id;
    try {
      await supabase.from('categories').update({ name: newName }).eq('name', oldName).eq('user_id', uid);
      await supabase.from('transactions').update({ category: newName }).eq('category', oldName).eq('user_id', uid);
      await supabase.from('recurring').update({ category: newName }).eq('category', oldName).eq('user_id', uid);
      await supabase.from('category_budgets').update({ category_name: newName }).eq('category_name', oldName).eq('user_id', uid);
      setCategories(prev => prev.map(c => c === oldName ? newName : c).sort());
      setTransactions(prev => prev.map(t => t.category === oldName ? { ...t, category: newName } : t));
      setRecurring(prev => prev.map(r => r.category === oldName ? { ...r, category: newName } : r));
      setCategoryBudgets(prev => prev.map(b => b.categoryName === oldName ? { ...b, categoryName: newName } : b));
    } catch (e) { console.error("Rename failed:", e); }
  };

  const handleCreateCategory = async (name: string) => {
    setCategories(prev => [...new Set([...prev, name])].sort());
    try { await createCategory(name); } catch (e) { console.error(e); }
  };

  const handleDeleteCategory = async (name: string) => {
    const supabase = initSupabase();
    if (!supabase || !session?.user) return;
    setCategories(prev => prev.filter(c => c !== name));
    try { await supabase.from('categories').delete().eq('name', name).eq('user_id', session.user.id); } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    const supabase = initSupabase();
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  const handleSaveAccount = async (acc: Account) => { setAccounts(prev => sortAccounts(prev.some(a => a.id === acc.id) ? prev.map(a => a.id === acc.id ? acc : a) : [...prev, acc])); try { await saveAccountToDb(acc); } catch (e) { console.error(e); } };
  const handleDeleteAccount = async (id: string) => { if (accounts.length <= 1) return alert("Min 1 account required."); setAccounts(prev => prev.filter(a => a.id !== id)); try { await deleteAccountFromDb(id); } catch (e) { console.error(e); } };
  const handleSaveRule = async (r: TransactionRule) => { setRules(prev => prev.some(item => item.id === r.id) ? prev.map(item => item.id === r.id ? r : item) : [...prev, r]); try { await saveRule(r); } catch (e) { console.error(e); } };
  const handleDeleteRule = async (id: string) => { setRules(prev => prev.filter(r => r.id !== id)); try { await deleteRule(id); } catch (e) { console.error(e); } };

  const handleAddTransaction = async (newTx: Transaction, makeRec?: boolean) => {
    setTransactions(prev => [newTx, ...prev]);
    try {
      await createTransaction(newTx);
      if (makeRec) {
        const r: RecurringTransaction = {
          id: crypto.randomUUID(),
          amount: newTx.amount,
          payee: newTx.payee,
          category: newTx.category,
          type: newTx.type,
          accountId: newTx.accountId,
          toAccountId: newTx.toAccountId,
          frequency: Frequency.MONTHLY,
          startDate: newTx.date,
          nextDueDate: format(calculateNextDate(parseISO(newTx.date), Frequency.MONTHLY), 'yyyy-MM-dd'),
          isActive: true,
          occurrencesProcessed: 1 // We already processed the first one
        };
        await createRecurring(r);
        setRecurring(prev => [...prev, r]);
      }
    } catch (e) { console.error(e); }
  };

  const handleEditTransaction = async (tx: Transaction) => { setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t)); try { await createTransaction(tx); } catch (e) { console.error(e); } };
  const handleDeleteTransaction = async (id: string) => { setTransactions(prev => prev.filter(t => t.id !== id)); try { await deleteTx(id); } catch (e) { console.error(e); } };
  const handleAddRecurring = async (r: RecurringTransaction) => { setRecurring(prev => [...prev, r]); try { await createRecurring(r); } catch (e) { console.error(e); } };
  const handleEditRecurring = async (r: RecurringTransaction) => { setRecurring(prev => prev.map(item => item.id === r.id ? r : item)); try { await createRecurring(r); } catch (e) { console.error(e); } };
  const handleDeleteRecurring = async (id: string) => { setRecurring(prev => prev.filter(r => r.id !== id)); try { await deleteRecurring(id); } catch (e) { console.error(e); } };
  const handleSaveValuation = async (v: Valuation) => { setValuations(prev => prev.some(item => item.id === v.id) ? prev.map(item => item.id === v.id ? v : item) : [...prev, v]); try { await saveValuation(v); } catch (e) { console.error(e); } };
  const handleDeleteValuation = async (id: string) => { setValuations(prev => prev.filter(v => v.id !== id)); try { await deleteValuation(id); } catch (e) { console.error(e); } };
  const handleSaveGoal = async (g: FinancialGoal) => { setGoals(prev => prev.some(item => item.id === g.id) ? prev.map(item => item.id === g.id ? g : item) : [...prev, g]); try { await saveGoal(g); } catch (e) { console.error(e); } };
  const handleDeleteGoal = async (id: string) => { setGoals(prev => prev.filter(g => g.id !== id)); try { await deleteGoal(id); } catch (e) { console.error(e); } };

  const handleMoveSingleRecurring = async (r: RecurringTransaction) => {
    const nextDue = parseISO(r.nextDueDate);
    const amount = getSmartAmount(r, nextDue, transactions);
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      date: format(nextDue, 'yyyy-MM-dd'),
      amount,
      payee: r.payee,
      category: r.category,
      type: r.type,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      isRecurring: true,
      recurringId: r.id,
      isReconciled: false
    };

    const newNextDue = calculateNextDate(nextDue, r.frequency, r.customInterval, r.customUnit);
    const updatedCount = (r.occurrencesProcessed || 0) + 1;
    const isNowActive = r.totalOccurrences ? (updatedCount < r.totalOccurrences) : true;

    const updatedR: RecurringTransaction = {
      ...r,
      nextDueDate: format(newNextDue, 'yyyy-MM-dd'),
      occurrencesProcessed: updatedCount,
      isActive: isNowActive
    };

    try {
      await createTransaction(newTx);
      await createRecurring(updatedR);
      setTransactions(prev => [newTx, ...prev]);
      setRecurring(prev => prev.map(old => old.id === r.id ? updatedR : old));
    } catch (e) {
      alert("Failed to post transaction.");
    }
  };

  const handleRestoreData = async (data: any) => {
    setIsRestoring(true); setRestorationProgress('Preparing restoration...');
    try {
      await clearAllUserData();
      if (data.categories?.length) await batchCreateCategories(data.categories);
      if (data.accounts?.length) await batchCreateAccounts(data.accounts);
      if (data.transactions?.length) await batchCreateTransactions(data.transactions);
      if (data.recurring?.length) await batchCreateRecurring(data.recurring);
      if (data.valuations?.length) await batchCreateValuations(data.valuations);
      if (data.goals?.length) await batchCreateGoals(data.goals);
      if (data.rules?.length) for (const r of data.rules) await saveRule(r);
      await loadData();
      alert("Data successfully restored from backup.");
    } catch (e: any) { alert("Restore failed: " + e.message); } finally { setIsRestoring(false); }
  };

  const renderContent = () => {
    const sortedAccs = sortAccounts(accounts);
    const commonProps = { transactions, recurring, categoryBudgets, accounts: sortedAccs, goals, selectedAccountId, valuations, rules };
    switch (activeTab) {
      case 'dashboard': return <Dashboard {...commonProps} />;
      case 'transactions': return <TransactionList {...commonProps} categories={categories} onAddTransaction={handleAddTransaction} onEditTransaction={handleEditTransaction} onDeleteTransaction={handleDeleteTransaction} onAddCategory={handleCreateCategory} />;
      case 'recurring': return (
        <RecurringManager
          {...commonProps}
          categories={categories}
          onAddRecurring={handleAddRecurring}
          onEditRecurring={handleEditRecurring}
          onDeleteRecurring={handleDeleteRecurring}
          onSaveCategoryBudget={saveCategoryBudget}
          onDeleteCategoryBudget={deleteCategoryBudget}
          onAddCategory={handleCreateCategory}
          onManualProcess={() => processDueRecurring(recurring, transactions)}
          onMoveSingle={handleMoveSingleRecurring}
        />
      );
      case 'goals': return <GoalsManager goals={goals} accounts={sortedAccs} onSaveGoal={handleSaveGoal} onDeleteGoal={handleDeleteGoal} />;
      case 'savings': return <AssetClassDashboard title="Savings" accountType="savings" icon={PiggyBank} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'investments': return <AssetClassDashboard title="Investments" accountType="investment" icon={TrendingUp} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'pension': return <AssetClassDashboard title="Pension" accountType="pension" icon={ShieldCheck} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'liabilities': return <AssetClassDashboard title="Liabilities" accountType="loan" icon={CreditCard} {...commonProps} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'forecast': return <ForecastView {...commonProps} insight={financialInsight} setInsight={setFinancialInsight} persistentChatMessages={chatMessages} onUpdateChatMessages={setChatMessages} chatSessionRef={chatSessionRef} />;
      case 'ai': return <ForecastView viewMode="ai" {...commonProps} insight={financialInsight} setInsight={setFinancialInsight} persistentChatMessages={chatMessages} onUpdateChatMessages={setChatMessages} chatSessionRef={chatSessionRef} />;
      case 'settings': return <Settings {...commonProps} categories={categories} onSaveAccount={handleSaveAccount} onDeleteAccount={handleDeleteAccount} onUpdateCategories={setCategories} onRenameCategory={handleRenameCategory} onRestoreData={handleRestoreData} onSaveRule={handleSaveRule} onDeleteRule={handleDeleteRule} onCreateCategory={handleCreateCategory} onDeleteCategory={handleDeleteCategory} />;
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
          <h1 className="text-xl font-bold text-white capitalize">{activeTab}</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsHelpOpen(true)} className="p-2 text-white/80 hover:text-white"><HelpCircle size={20} /></button>
            <div className="relative group">
              <div className="flex items-center gap-2 cursor-pointer bg-orange-700 px-3 py-1.5 rounded-lg border border-orange-800 text-white text-sm font-medium">
                {selectedAccountId ? accounts.find(a => a.id === selectedAccountId)?.name : 'All Accounts'} <ChevronDown size={16} />
              </div>
              <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <button onClick={() => setSelectedAccountId(null)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b">All Accounts</button>
                {accounts.map(acc => (<button key={acc.id} onClick={() => setSelectedAccountId(acc.id)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50"> {acc.name} </button>))}
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
          <div className="text-xl font-black uppercase tracking-widest">Restoring...</div>
          <p className="text-slate-200 text-sm font-black animate-pulse">{restorationProgress}</p>
        </div>
      )}
    </div>
  );
};
export default App;
