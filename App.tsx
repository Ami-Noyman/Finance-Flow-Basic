
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TransactionList } from './components/TransactionList';
import { RecurringManager } from './components/RecurringManager';
import { ForecastView } from './components/ForecastView';
import { Settings } from './components/Settings';
import { AssetClassDashboard } from './components/AssetClassDashboard';
import { Auth } from './components/Auth';
import { HelpPanel } from './components/HelpPanel';
import { Transaction, RecurringTransaction, Account, TransactionType, Frequency, AmountType, SmartCategoryBudget, Valuation } from './types';
import { 
  fetchTransactions, createAccount as saveAccountToDb, batchCreateAccounts, updateAccountsLinks, fetchAccounts, fetchRecurring, createRecurring, batchCreateRecurring, fetchCategories, createCategory, batchCreateCategories, deleteAccount as deleteAccountFromDb, deleteRecurring, deleteTransaction as deleteTx, clearAllUserData, batchCreateTransactions,
  fetchCategoryBudgets, batchCreateCategoryBudgets, saveCategoryBudget, deleteCategoryBudget, createTransaction, fetchValuations, batchCreateValuations, saveValuation, deleteValuation, createAccountSubType, batchCreateAccountSubTypes
} from './services/storageService';
import { initSupabase, isConfigured } from './services/supabaseClient';
import { ChevronDown, PiggyBank, ShieldCheck, LogOut, HelpCircle, Loader } from 'lucide-react';
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
  
  // Persistence for AI Chat
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const chatSessionRef = useRef<Chat | null>(null);

  const [isLoading, setIsLoading] = useState(true); 
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [financialInsight, setFinancialInsight] = useState<string | null>(null);
  
  const hasProcessedRef = useRef(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = initSupabase();
    if (!supabase) {
        setIsLoading(false);
        return;
    }

    supabase.auth.getSession().then(({ data: { session } }: any) => {
      setSession(session);
      setIsLoading(false);
    }).catch(err => {
      console.error("Session check failed", err);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [isSetup]);

  useEffect(() => { 
    if (session?.user) {
      loadData(); 
    } else {
      setTransactions([]);
      setRecurring([]);
      setAccounts([]);
      setCategories([]);
      setCategoryBudgets([]);
      setValuations([]);
      setFinancialInsight(null);
      setChatMessages([]);
      chatSessionRef.current = null;
      hasProcessedRef.current = false;
    }
  }, [session]);

  const loadData = async () => {
    if (!session?.user) return;
    try {
      const uid = session.user.id;
      const [accs, txs, recs, cats, budgets, vals] = await Promise.all([
        fetchAccounts(uid),
        fetchTransactions(uid),
        fetchRecurring(uid),
        fetchCategories(uid),
        fetchCategoryBudgets(uid),
        fetchValuations(uid)
      ]);
      setAccounts(sortAccounts(accs || []));
      setTransactions(txs || []);
      setRecurring(recs || []);
      setCategories(cats || []);
      setCategoryBudgets(budgets || []);
      setValuations(vals || []);
    } catch (e: any) { 
      console.error("Error loading data:", e);
    }
  };

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const handleLogout = async () => {
    const supabase = initSupabase();
    if(supabase) await supabase.auth.signOut();
    setSession(null);
  };

  useEffect(() => { mainContentRef.current?.scrollTo(0, 0); }, [activeTab]);

  const getSafePayee = (r: any) => r.payee || r.description || 'Processed Commitment';

  const handleSaveAccount = async (acc: Account) => {
    setAccounts(prev => {
        const exists = prev.some(a => a.id === acc.id);
        const newList = exists ? prev.map(a => a.id === acc.id ? acc : a) : [...prev, acc];
        return sortAccounts(newList);
    });
    try {
        await saveAccountToDb(acc);
    } catch (e: any) {
        console.error("Failed to save account:", e);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (accounts.length <= 1) {
        alert("You must have at least one account.");
        return;
    }
    setAccounts(prev => prev.filter(a => a.id !== id));
    try {
        await deleteAccountFromDb(id);
    } catch (e: any) {
        console.error("Failed to delete account:", e);
    }
  };

  const handleAddTransaction = async (newTx: Transaction, makeRecurring?: boolean) => {
    setTransactions(prev => [newTx, ...prev]);
    try {
      await createTransaction(newTx);
      if (makeRecurring) {
        const nextDate = format(calculateNextDate(parseISO(newTx.date), Frequency.MONTHLY), 'yyyy-MM-dd');
        const newRec: RecurringTransaction = { id: crypto.randomUUID(), amount: newTx.amount, amountType: AmountType.FIXED, payee: newTx.payee, notes: newTx.notes, category: newTx.category, type: newTx.type, accountId: newTx.accountId, toAccountId: newTx.toAccountId, frequency: Frequency.MONTHLY, startDate: newTx.date, nextDueDate: nextDate, isActive: true, occurrencesProcessed: 1 };
        setRecurring(prev => [...prev, newRec]);
        await createRecurring(newRec);
      }
    } catch (e: any) { 
        console.error("Save failed:", e);
    }
  };

  const handleEditTransaction = async (updatedTx: Transaction) => {
    setTransactions(prev => prev.map(t => t.id === updatedTx.id ? updatedTx : t));
    try {
      await createTransaction(updatedTx); 
    } catch (e: any) {
      console.error("Edit failed:", e);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    try {
      await deleteTx(id);
    } catch (e: any) {
      console.error("Delete failed:", e);
    }
  };
  
  const handleAddRecurring = async (newRec: RecurringTransaction) => {
    setRecurring(prev => [...prev, newRec]);
    try {
      await createRecurring(newRec);
    } catch (e: any) {
      console.error("Add recurring failed:", e);
    }
  };

  const handleEditRecurring = async (updatedRec: RecurringTransaction) => {
    setRecurring(prev => prev.map(r => r.id === updatedRec.id ? updatedRec : r));
    try {
      await createRecurring(updatedRec);
    } catch (e: any) {
      console.error("Edit recurring failed:", e);
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    setRecurring(prev => prev.filter(r => r.id !== id));
    try {
      await deleteRecurring(id);
    } catch (e: any) {
      console.error("Delete recurring failed:", e);
    }
  };

  const handleSaveCategoryBudget = async (b: SmartCategoryBudget) => {
      setCategoryBudgets(prev => {
          const exists = prev.some(item => item.id === b.id);
          return exists ? prev.map(item => item.id === b.id ? b : item) : [...prev, b];
      });
      try {
        await saveCategoryBudget(b);
      } catch (e: any) {
        console.error("Save budget failed:", e);
      }
  };

  const handleDeleteCategoryBudget = async (id: string) => {
      setCategoryBudgets(prev => prev.filter(b => b.id !== id));
      try {
        await deleteCategoryBudget(id);
      } catch (e: any) {
        console.error("Delete budget failed:", e);
      }
  };

  const handleSaveValuation = async (v: Valuation) => {
      setValuations(prev => {
          const exists = prev.some(item => item.id === v.id);
          return exists ? prev.map(item => item.id === v.id ? v : item) : [...prev, v].sort((a, b) => a.date.localeCompare(b.date));
      });
      try {
        await saveValuation(v);
      } catch (e: any) {
        console.error("Save valuation failed:", e);
      }
  };

  const handleDeleteValuation = async (id: string) => {
      setValuations(prev => prev.filter(v => v.id !== id));
      try {
        await deleteValuation(id);
      } catch (e: any) {
        console.error("Delete valuation failed:", e);
      }
  };

  const handleMoveSingleRecurring = async (r: RecurringTransaction) => {
      const amount = getSmartAmount(r, parseISO(r.nextDueDate), transactions);
      const newTx: Transaction = { 
        id: crypto.randomUUID(), 
        date: r.nextDueDate, 
        amount, 
        payee: getSafePayee(r), 
        notes: r.notes, 
        category: r.category, 
        type: r.type, 
        accountId: r.accountId, 
        toAccountId: r.toAccountId, 
        isRecurring: true, 
        recurringId: r.id 
      };
      const nextDate = format(calculateNextDate(parseISO(r.nextDueDate), r.frequency, r.customInterval, r.customUnit), 'yyyy-MM-dd');
      const newProcessedCount = (r.occurrencesProcessed || 0) + 1;
      const updatedRec = { ...r, nextDueDate: nextDate, occurrencesProcessed: newProcessedCount, isActive: (r.totalOccurrences && newProcessedCount >= r.totalOccurrences) ? false : r.isActive };
      
      setTransactions(prev => [newTx, ...prev]);
      setRecurring(prev => prev.map(item => item.id === r.id ? updatedRec : item));
      
      try {
        await Promise.all([createTransaction(newTx), createRecurring(updatedRec)]);
      } catch (e: any) {
        console.error("Process single recurring failed:", e);
      }
  };

  const handleAddCategory = async (newCat: string) => {
      if (!categories.includes(newCat)) {
          setCategories(prev => [...prev, newCat].sort());
          try {
            await createCategory(newCat);
          } catch (e: any) {
            console.error("Add category failed:", e);
          }
      }
  };

  const handleRenameCategory = async (oldName: string, newName: string) => {
    const newCategories = categories.map(c => c === oldName ? newName : c).sort();
    setCategories(newCategories);
    const updatedTxs = transactions.map(t => t.category === oldName ? { ...t, category: newName } : t);
    setTransactions(updatedTxs);
    const updatedRecs = recurring.map(r => r.category === oldName ? { ...r, category: newName } : r);
    setRecurring(updatedRecs);

    try {
      await createCategory(newName);
      const linkedTxs = updatedTxs.filter(t => t.category === newName);
      for (const t of linkedTxs) await createTransaction(t);
      const linkedRecs = updatedRecs.filter(r => r.category === newName);
      for (const r of linkedRecs) await createRecurring(r);
    } catch (e) {
      console.error("Rename category persistence failed", e);
    }
  };

  const handleRestoreData = async (data: any) => {
    setIsRestoring(true);
    setRestorationProgress('Preparing data synchronization...');
    
    try {
      console.log("Full Backup Object Analysis:", Object.keys(data));
      
      if (!data.accounts || !Array.isArray(data.accounts)) {
          throw new Error("Invalid backup file: Missing 'accounts' array.");
      }

      setRestorationProgress('Normalizing identifiers...');
      const isUuid = (id: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
      const idMap = new Map<string, string>();

      data.accounts = data.accounts.map((acc: any) => {
          if (!isUuid(acc.id)) {
              const newId = crypto.randomUUID();
              idMap.set(acc.id, newId);
              return { ...acc, id: newId };
          }
          return acc;
      });

      data.accounts = data.accounts.map((acc: any) => {
          if (acc.payFromAccountId && idMap.has(acc.payFromAccountId)) {
              return { ...acc, payFromAccountId: idMap.get(acc.payFromAccountId) };
          }
          return acc;
      });

      if (data.transactions) {
          data.transactions = data.transactions.map((tx: any) => {
              const updated = { ...tx };
              if (!isUuid(tx.id)) updated.id = crypto.randomUUID();
              if (idMap.has(tx.accountId)) updated.accountId = idMap.get(tx.accountId);
              if (tx.toAccountId && idMap.has(tx.toAccountId)) updated.toAccountId = idMap.get(tx.toAccountId);
              if (!updated.payee && updated.description) updated.payee = updated.description;
              if (!updated.payee) updated.payee = 'Unknown Entry';
              return updated;
          });
      }

      if (data.recurring) {
          data.recurring = data.recurring.map((rec: any) => {
              const updated = { ...rec };
              if (!isUuid(rec.id)) updated.id = crypto.randomUUID();
              if (idMap.has(rec.accountId)) updated.accountId = idMap.get(rec.accountId);
              if (rec.toAccountId && idMap.has(rec.toAccountId)) updated.toAccountId = idMap.get(rec.toAccountId);
              if (!updated.payee && updated.description) updated.payee = updated.description;
              if (!updated.payee) updated.payee = 'Unknown Commitment';
              return updated;
          });
      }

      if (data.valuations) {
          data.valuations = data.valuations.map((val: any) => {
              const updated = { ...val };
              if (!isUuid(val.id)) updated.id = crypto.randomUUID();
              if (idMap.has(val.accountId)) updated.accountId = idMap.get(val.accountId);
              return updated;
          });
      }

      setRestorationProgress('Phase 1/8: Purging existing cloud records...');
      await clearAllUserData();

      if (data.categories && Array.isArray(data.categories)) {
        setRestorationProgress(`Phase 2/8: Restoring ${data.categories.length} categories...`);
        await batchCreateCategories(data.categories.filter((c: any) => typeof c === 'string'));
      }
      
      if (data.accountSubTypes && Array.isArray(data.accountSubTypes)) {
          setRestorationProgress(`Phase 2b/8: Restoring account types...`);
          await batchCreateAccountSubTypes(data.accountSubTypes.filter((s: any) => typeof s === 'string'));
      }

      setRestorationProgress(`Phase 3/8: Initializing ${data.accounts.length} accounts...`);
      const skeletons = data.accounts.map((a: any) => ({ ...a, payFromAccountId: undefined }));
      await batchCreateAccounts(skeletons);
      await updateAccountsLinks(data.accounts);

      const accountIdsFromBackup = new Set(data.accounts.map((a: any) => a.id));

      if (data.transactions && Array.isArray(data.transactions) && data.transactions.length > 0) {
        const validTxs = data.transactions.filter((t: any) => accountIdsFromBackup.has(t.accountId || t.account_id));
        const CHUNK_SIZE = 100; 
        for (let i = 0; i < validTxs.length; i += CHUNK_SIZE) {
            const chunk = validTxs.slice(i, i + CHUNK_SIZE);
            setRestorationProgress(`Phase 4/8: Syncing transactions (${i + chunk.length}/${validTxs.length})...`);
            await batchCreateTransactions(chunk);
        }
      }

      if (data.recurring && Array.isArray(data.recurring)) {
        const validRecs = data.recurring.filter((r: any) => accountIdsFromBackup.has(r.accountId || r.account_id));
        setRestorationProgress(`Phase 5/8: Restoring commitments...`);
        await batchCreateRecurring(validRecs);
      }

      if (data.valuations && Array.isArray(data.valuations)) {
          const validVals = data.valuations.filter((v: any) => accountIdsFromBackup.has(v.accountId || v.account_id));
          setRestorationProgress(`Phase 6/8: Syncing valuations...`);
          await batchCreateValuations(validVals);
      }

      // --- ULTIMATE AGGRESSIVE BUDGET EXTRACTION ---
      setRestorationProgress(`Phase 7/8: Performing Brute-Force Budget Rescue...`);
      let recoveredBudgets: any[] = [];
      
      // 1. Direct Keys
      const directCandidates = data.categoryBudgets || data.spendLimits || data.budgets || data.limits || data.spend_limits;
      if (Array.isArray(directCandidates)) recoveredBudgets = [...directCandidates];

      // 2. Global Fuzzy Search (recursive through all objects)
      const foundInArrays: any[] = [];
      const seen = new Set();
      const findBudgets = (obj: any) => {
          if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
          seen.add(obj);
          if (Array.isArray(obj)) {
              obj.forEach(item => {
                  if (item && typeof item === 'object') {
                      const keys = Object.keys(item).map(k => k.toLowerCase());
                      const hasCategory = keys.some(k => k.includes('category') || k === 'cat' || k === 'name');
                      const hasLimit = keys.some(k => k.includes('limit') || k.includes('budget') || k === 'amount');
                      if (hasCategory && hasLimit && !keys.includes('date') && !keys.includes('payee')) {
                          foundInArrays.push(item);
                      }
                  }
                  findBudgets(item);
              });
          } else {
              Object.values(obj).forEach(val => findBudgets(val));
          }
      };
      findBudgets(data);
      
      // Merge unique ones
      const finalRaw = recoveredBudgets.length > 0 ? recoveredBudgets : foundInArrays;
      const normalizedBudgets = finalRaw.map((b: any) => {
          const keys = Object.keys(b);
          const catKey = keys.find(k => k.toLowerCase().includes('category') || k.toLowerCase() === 'name') || 'categoryName';
          const limitKey = keys.find(k => k.toLowerCase().includes('limit') || k.toLowerCase().includes('budget')) || 'monthlyLimit';
          
          return {
              id: b.id || crypto.randomUUID(),
              categoryName: String(b[catKey] || 'Unknown'),
              monthlyLimit: Number(b[limitKey] || 0),
              useAverage: b.useAverage ?? b.use_average ?? false,
              isActive: b.isActive ?? b.is_active ?? true
          };
      }).filter(b => b.categoryName !== 'Unknown' && b.monthlyLimit > 0);

      if (normalizedBudgets.length > 0) {
          console.log(`Rescue complete: Restoring ${normalizedBudgets.length} budgets.`);
          await batchCreateCategoryBudgets(normalizedBudgets);
      }

      setRestorationProgress('Phase 8/8: Finalizing...');
      await loadData();
      alert(`SUCCESS: Data restored. Found ${normalizedBudgets.length} Spend Limits.`);
    } catch (e: any) {
      console.error("Restoration failure:", e);
      alert(`RESTORE FAILED: ${e.message}`);
    } finally {
      setIsRestoring(false);
      setRestorationProgress('');
    }
  };

  const runAutoProcess = async () => {
    if (!session?.user) return;
    try {
      const today = startOfDay(new Date());
      let newTxs: Transaction[] = [];
      let updatedRecs: RecurringTransaction[] = [...recurring];
      let hasChanges = false;
      
      updatedRecs = updatedRecs.map(r => {
        if (!r.isActive) return r;
        let modified = false;
        let nextD = parseISO(r.nextDueDate);
        let processed = 0;
        while ((isBefore(nextD, today) || isSameDay(nextD, today)) && processed < 24) {
             if (r.totalOccurrences && ((r.occurrencesProcessed || 0) + processed) >= r.totalOccurrences) break;
             newTxs.push({ 
               id: crypto.randomUUID(), 
               date: format(nextD, 'yyyy-MM-dd'), 
               amount: getSmartAmount(r, nextD, transactions), 
               payee: getSafePayee(r), 
               notes: r.notes, 
               category: r.category, 
               type: r.type, 
               accountId: r.accountId, 
               toAccountId: r.toAccountId, 
               isRecurring: true, 
               recurringId: r.id 
             });
             nextD = calculateNextDate(nextD, r.frequency, r.customInterval, r.customUnit);
             processed++; 
             modified = true;
        }
        if (modified) {
            hasChanges = true;
            const newCount = (r.occurrencesProcessed || 0) + processed;
            return { ...r, nextDueDate: format(nextD, 'yyyy-MM-dd'), occurrencesProcessed: newCount, isActive: (r.totalOccurrences && newCount >= r.totalOccurrences) ? false : r.isActive };
        }
        return r;
      });
      
      if (hasChanges) {
          setTransactions(prev => [...newTxs, ...prev]);
          setRecurring(updatedRecs);
          await batchCreateTransactions(newTxs);
          for (const r of updatedRecs) await createRecurring(r);
      }
    } catch (e: any) { 
        console.error("Auto-process error:", e); 
    }
  };

  useEffect(() => {
    if (session?.user && !isLoading && recurring.length > 0 && !hasProcessedRef.current) {
        runAutoProcess(); 
        hasProcessedRef.current = true;
    }
  }, [session, isLoading, recurring.length]);

  if (isLoading) return <div className="flex h-screen w-screen items-center justify-center bg-gray-50 flex-col gap-4 text-orange-600"> <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin"></div> <div>Loading your flow...</div> </div>;
  if (!session) return <Auth onConfigured={() => setIsSetup(true)} />;

  const renderContent = () => {
    const commonForecastProps = {
      transactions,
      recurring,
      categoryBudgets,
      accounts: sortedAccounts,
      selectedAccountId,
      insight: financialInsight,
      setInsight: setFinancialInsight,
      persistentChatMessages: chatMessages,
      onUpdateChatMessages: setChatMessages,
      chatSessionRef
    };

    switch (activeTab) {
      case 'dashboard': return <Dashboard transactions={transactions} recurring={recurring} categoryBudgets={categoryBudgets} accounts={sortedAccounts} selectedAccountId={selectedAccountId} />;
      case 'transactions': return <TransactionList transactions={transactions} accounts={sortedAccounts} categories={categories} selectedAccountId={selectedAccountId} onAddTransaction={handleAddTransaction} onEditTransaction={handleEditTransaction} onDeleteTransaction={handleDeleteTransaction} onAddCategory={handleAddCategory} />;
      case 'recurring': return <RecurringManager recurring={recurring} categoryBudgets={categoryBudgets} accounts={sortedAccounts} categories={categories} transactions={transactions} onAddRecurring={handleAddRecurring} onEditRecurring={handleEditRecurring} onDeleteRecurring={handleDeleteRecurring} onSaveCategoryBudget={handleSaveCategoryBudget} onDeleteCategoryBudget={handleDeleteCategoryBudget} onAddCategory={handleAddCategory} onManualProcess={runAutoProcess} onMoveSingle={handleMoveSingleRecurring} />;
      case 'savings': return <AssetClassDashboard title="Savings" accountType="savings" icon={PiggyBank} accounts={sortedAccounts} transactions={transactions} valuations={valuations} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'pension': return <AssetClassDashboard title="Pension" accountType="pension" icon={ShieldCheck} accounts={sortedAccounts} transactions={transactions} valuations={valuations} onSaveValuation={handleSaveValuation} onDeleteValuation={handleDeleteValuation} />;
      case 'forecast': return <ForecastView {...commonForecastProps} />;
      case 'ai': return <ForecastView {...commonForecastProps} viewMode="ai" />;
      case 'settings': return <Settings accounts={sortedAccounts} categories={categories} transactions={transactions} recurring={recurring} onSaveAccount={handleSaveAccount} onDeleteAccount={handleDeleteAccount} onUpdateCategories={setCategories} onRenameCategory={handleRenameCategory} onRestoreData={handleRestoreData} />;
      default: return <Dashboard transactions={transactions} recurring={recurring} categoryBudgets={categoryBudgets} accounts={sortedAccounts} selectedAccountId={selectedAccountId} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans text-gray-900 relative">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-orange-600 border-b border-orange-700 px-6 py-3 flex justify-between items-center shadow-sm z-10 transition-colors">
          <div className="flex items-center gap-2"> <h1 className="text-xl font-bold text-white capitalize hidden lg:block">{activeTab}</h1> <span className="text-xs bg-orange-800 text-white px-2 py-0.5 rounded-full font-mono">Supabase</span> </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsHelpOpen(true)} className="p-2 text-white/80 hover:text-white hover:bg-orange-700 rounded-lg transition-all" title="עזרה והסברים"><HelpCircle size={20} /></button>
            <div className="h-6 w-px bg-orange-500 mx-1"></div>
            <div className="relative group">
                <div className="flex items-center gap-2 cursor-pointer bg-orange-700 hover:bg-orange-800 px-3 py-1.5 rounded-lg border border-orange-800 shadow-sm transition-colors">
                  <span className="text-sm font-medium text-white">{selectedAccountId ? accounts.find(a => a.id === selectedAccountId)?.name : 'All Accounts'}</span>
                  <ChevronDown size={16} className="text-white" />
                </div>
                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button onClick={() => setSelectedAccountId(null)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50">All Accounts</button>
                  {sortedAccounts.map(acc => ( <button key={acc.id} onClick={() => setSelectedAccountId(acc.id)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50"> {acc.name} ({acc.currency}) </button> ))}
                </div>
            </div>
            <div className="h-6 w-px bg-orange-500 mx-1"></div>
            <button onClick={handleLogout} className="text-white/80 hover:text-white p-1" title="Sign Out"> <LogOut size={18} /> </button>
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
