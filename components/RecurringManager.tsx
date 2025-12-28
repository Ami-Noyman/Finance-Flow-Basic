
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { RecurringTransaction, TransactionType, Frequency, Account, AmountType, Transaction, SmartCategoryBudget, TransactionRule } from '../types';
import { Plus, Trash2, Calendar, Repeat, Edit2, Info, Clock, AlertCircle, X, CheckCircle, BrainCircuit, Target, StickyNote, PieChart as PieIcon, BarChart3, TrendingUp, ArrowRightLeft, Play, Filter, RotateCcw, AlertTriangle, ArrowRight, Save, RefreshCw } from 'lucide-react';
import { categorizeTransaction } from '../services/geminiService';
import { formatCurrency } from '../utils/currency';
import { parseISO, isBefore, startOfDay, isValid, format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { getEffectiveCategoryBudget, calculateCategoryMonthlyAverage, sortAccounts, calculateRemainingCommittedSpend } from '../utils/finance';

interface RecurringManagerProps {
  recurring: RecurringTransaction[];
  categoryBudgets: SmartCategoryBudget[];
  accounts: Account[];
  categories: string[];
  rules: TransactionRule[];
  transactions?: Transaction[];
  onAddRecurring: (r: RecurringTransaction) => Promise<void>;
  onEditRecurring: (r: RecurringTransaction) => Promise<void>;
  onDeleteRecurring: (id: string) => Promise<void>;
  onSaveCategoryBudget: (b: SmartCategoryBudget) => Promise<void>;
  onDeleteCategoryBudget: (id: string) => Promise<void>;
  onAddCategory: (category: string) => void;
  onManualProcess?: () => void;
  onMoveSingle?: (r: RecurringTransaction) => void;
}

export const RecurringManager: React.FC<RecurringManagerProps> = ({ 
  recurring,
  categoryBudgets,
  accounts,
  categories,
  rules,
  transactions = [],
  onAddRecurring,
  onEditRecurring,
  onDeleteRecurring,
  onSaveCategoryBudget,
  onDeleteCategoryBudget,
  onAddCategory,
  onManualProcess,
  onMoveSingle
}) => {
  const [activeTab, setActiveTab] = useState<'recurring' | 'smart'>('recurring');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  
  // Filtering state
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');

  // Recurring Form
  const [amount, setAmount] = useState('');
  const [amountType, setAmountType] = useState<AmountType>(AmountType.FIXED);
  const [payee, setPayee] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [type, setType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [frequency, setFrequency] = useState<Frequency>(Frequency.MONTHLY);
  const [customInterval, setCustomInterval] = useState('1');
  const [customUnit, setCustomUnit] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Type-ahead states
  const [payeeSuggestions, setPayeeSuggestions] = useState<string[]>([]);
  const [showPayeeSuggestions, setShowPayeeSuggestions] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  // Budget Form
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetUseAvg, setBudgetUseAvg] = useState(false);

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const payeeRef = useRef<HTMLDivElement>(null);
  const categoryInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (payeeRef.current && !payeeRef.current.contains(event.target as Node)) {
        setShowPayeeSuggestions(false);
      }
      if (categoryInputRef.current && !categoryInputRef.current.contains(event.target as Node)) {
        setShowCategorySuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const lookupHistoricalCategory = (payeeName: string) => {
    if (!payeeName) return;
    const normalized = payeeName.toLowerCase().trim();
    
    // Check rules first
    const matchedRule = rules.find(r => r.isActive && normalized.includes(r.payeePattern.toLowerCase()));
    if (matchedRule) {
      setCategory(matchedRule.category);
      setCustomCategory('');
      return;
    }

    // Check history (last known for this payee)
    const matches = transactions.filter(t => (t.payee || (t as any).description || '').toLowerCase().trim() === normalized);
    const recMatches = recurring.filter(r => (r.payee || '').toLowerCase().trim() === normalized);
    
    const combined = [...matches, ...recMatches];
    if (combined.length > 0) {
      const counts: Record<string, number> = {};
      combined.forEach(m => counts[m.category] = (counts[m.category] || 0) + 1);
      const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      
      if (categories.includes(topCategory)) {
        setCategory(topCategory);
        setCustomCategory('');
      } else if (topCategory !== 'Transfer') {
        setCategory('Other');
        setCustomCategory(topCategory);
      }
    }
  };

  const handlePayeeInputChange = (value: string) => {
    setPayee(value);
    if (value.length > 0) {
      const distinct = Array.from(new Set([
        ...transactions.map(t => (t.payee || (t as any).description || '') as string),
        ...recurring.map(r => (r.payee || '') as string)
      ])).filter(p => !!p);
      const filtered = distinct.filter(p => p.toLowerCase().includes(value.toLowerCase())).slice(0, 5);
      setPayeeSuggestions(filtered);
      setShowPayeeSuggestions(true);
    } else {
      setShowPayeeSuggestions(false);
    }
  };

  const handleSelectPayeeSuggestion = (selected: string) => {
    setPayee(selected);
    setShowPayeeSuggestions(false);
    lookupHistoricalCategory(selected);
  };

  const handleCategoryInputChange = (value: string) => {
    setCustomCategory(value);
    if (value.length > 0) {
      const filtered = categories.filter(c => c.toLowerCase().includes(value.toLowerCase())).slice(0, 5);
      setCategorySuggestions(filtered);
      setShowCategorySuggestions(true);
    } else {
      setShowCategorySuggestions(false);
    }
  };

  const getPayeeName = (r: any) => r.payee || r.description || '';

  const handleOpenModal = (r?: RecurringTransaction) => {
    if (r) {
      const rAny = r as any;
      setEditingId(r.id);
      setAmount(r.amount.toString());
      setAmountType(r.amountType || AmountType.FIXED);
      setPayee(r.payee || rAny.description || '');
      setNotes(r.notes || '');
      setCategory(categories.includes(r.category) ? r.category : 'Other');
      if (!categories.includes(r.category) && r.type !== TransactionType.TRANSFER) setCustomCategory(r.category);
      setType(r.type);
      setFrequency(r.frequency);
      setCustomInterval(r.customInterval ? r.customInterval.toString() : '1');
      setCustomUnit(r.customUnit || 'month');
      setStartDate(r.nextDueDate || r.startDate || format(new Date(), 'yyyy-MM-dd'));
      setAccountId(r.accountId);
      setToAccountId(r.toAccountId || '');
    } else {
      resetForm();
      // FIX: Explicitly initialize accountId to first available account
      if (sortedAccounts.length > 0) setAccountId(sortedAccounts[0].id);
    }
    setIsModalOpen(true);
  };

  const handleOpenBudgetModal = (b?: SmartCategoryBudget) => {
    if (b) {
      setEditingBudgetId(b.id);
      setBudgetCategory(b.categoryName);
      setBudgetLimit(b.monthlyLimit.toString());
      setBudgetUseAvg(b.useAverage);
    } else {
      setEditingBudgetId(null);
      setBudgetCategory(categories[0] || '');
      setBudgetLimit('');
      setBudgetUseAvg(false);
    }
    setIsBudgetModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !payee || !accountId) return;
    setIsProcessing(true);
    
    let finalCategory = category === 'Other' ? customCategory : category;
    if (type === TransactionType.TRANSFER) {
        finalCategory = 'Transfer';
    } else if (!finalCategory) {
        finalCategory = await categorizeTransaction(payee, parseFloat(amount), transactions, rules, categories);
    }
    
    if (category === 'Other' && customCategory && !categories.includes(customCategory)) {
        onAddCategory(customCategory);
    }

    const recData: RecurringTransaction = {
      id: editingId || crypto.randomUUID(),
      amount: parseFloat(amount),
      amountType,
      payee,
      notes: notes.trim() || undefined,
      category: finalCategory || 'כללי',
      type,
      accountId,
      toAccountId: type === TransactionType.TRANSFER ? toAccountId : undefined,
      frequency,
      customInterval: frequency === Frequency.CUSTOM ? parseInt(customInterval) : undefined,
      customUnit: frequency === Frequency.CUSTOM ? customUnit : undefined,
      startDate: editingId ? (recurring.find(r => r.id === editingId)?.startDate || startDate) : startDate,
      nextDueDate: startDate, 
      isActive: true,
      totalOccurrences: undefined, // Total installments logic
      occurrencesProcessed: editingId ? (recurring.find(r => r.id === editingId)?.occurrencesProcessed || 0) : 0
    };

    if (editingId) await onEditRecurring(recData); 
    else await onAddRecurring(recData);
    
    setIsProcessing(false); setIsModalOpen(false); resetForm();
  };

  const handleSubmitBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetCategory || (!budgetLimit && !budgetUseAvg)) return;
    const b: SmartCategoryBudget = {
        id: editingBudgetId || crypto.randomUUID(),
        categoryName: budgetCategory,
        monthlyLimit: parseFloat(budgetLimit) || 0,
        useAverage: budgetUseAvg,
        isActive: true
    };
    await onSaveCategoryBudget(b);
    setIsBudgetModalOpen(false);
  };

  const resetForm = () => {
    setEditingId(null); setAmount(''); setPayee(''); setNotes(''); setCategory(''); setCustomCategory(''); setType(TransactionType.EXPENSE); setFrequency(Frequency.MONTHLY); setStartDate(format(new Date(), 'yyyy-MM-dd')); setAccountId(''); setToAccountId(''); setAmountType(AmountType.FIXED); setCustomInterval('1'); setCustomUnit('month');
    setPayeeSuggestions([]); setShowPayeeSuggestions(false);
    setCategorySuggestions([]); setShowCategorySuggestions(false);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterCategory('');
    setFilterAccount('');
    setFilterType('');
    setFilterMinAmount('');
  };

  const filteredRecurring = useMemo(() => {
    return recurring.filter(r => {
        const pName = getPayeeName(r).toLowerCase();
        if (searchTerm && !pName.includes(searchTerm.toLowerCase())) return false;
        if (filterCategory && r.category !== filterCategory) return false;
        if (filterAccount && (r.accountId !== filterAccount && r.toAccountId !== filterAccount)) return false;
        if (filterType && r.type !== filterType) return false;
        if (filterMinAmount) {
          const min = parseFloat(filterMinAmount);
          if (!isNaN(min) && r.amount < min) return false;
        }
        return true;
    }).sort((a, b) => (a.nextDueDate || '').localeCompare(b.nextDueDate || ''));
  }, [recurring, searchTerm, filterCategory, filterAccount, filterType, filterMinAmount]);

  const categorySpentCurrentMonth = useMemo(() => {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    const totals: Record<string, number> = {};
    transactions.forEach(t => {
      const tDate = parseISO(t.date);
      if (t.type === TransactionType.EXPENSE && isWithinInterval(tDate, { start, end })) {
        totals[t.category] = (totals[t.category] || 0) + t.amount;
      }
    });
    return totals;
  }, [transactions]);

  const totalMonthlyCommitted = useMemo(() => {
    return recurring.filter(r => r.isActive && r.type === TransactionType.EXPENSE).reduce((sum, r) => {
      let multiplier = 1;
      switch (r.frequency) {
        case Frequency.WEEKLY: multiplier = 52 / 12; break;
        case Frequency.BIWEEKLY: multiplier = 26 / 12; break;
        case Frequency.MONTHLY: multiplier = 1; break;
        case Frequency.BIMONTHLY: multiplier = 0.5; break;
        case Frequency.QUARTERLY: multiplier = 1 / 3; break;
        case Frequency.YEARLY: multiplier = 1 / 12; break;
        case Frequency.CUSTOM:
          const interval = r.customInterval || 1;
          const unit = r.customUnit || 'month';
          if (unit === 'day') multiplier = (365 / 12) / interval;
          else if (unit === 'week') multiplier = (52 / 12) / interval;
          else if (unit === 'month') multiplier = 1 / interval;
          else if (unit === 'year') multiplier = (1 / 12) / interval;
          break;
      }
      return sum + (r.amount * multiplier);
    }, 0);
  }, [recurring]);

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col animate-fade-in pb-2">
      <div className="flex justify-between items-center bg-white p-3 rounded-2xl shadow-sm border border-gray-100 shrink-0">
          <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
              <button onClick={() => setActiveTab('recurring')} className={`px-5 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-2 ${activeTab === 'recurring' ? 'bg-brand-600 text-white shadow-md' : 'text-gray-500 hover:bg-white'}`}>
                <Repeat size={16}/> Commitments
              </button>
              <button onClick={() => setActiveTab('smart')} className={`px-5 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-2 ${activeTab === 'smart' ? 'bg-brand-600 text-white shadow-md' : 'text-gray-500 hover:bg-white'}`}>
                <Target size={16}/> Spend Limits
              </button>
          </div>

          <div className="flex items-center gap-6">
              <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Monthly Commitment</p>
                  <p className="text-lg font-black text-slate-900 leading-none">{formatCurrency(totalMonthlyCommitted)}</p>
              </div>
              <div className="h-8 w-px bg-gray-100"></div>
              <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowFilters(!showFilters)} 
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all shadow-sm ${showFilters ? 'bg-brand-600 border-brand-700 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                      <Filter size={14} />
                      Filter
                  </button>
                  <button onClick={onManualProcess} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all active:scale-95">
                      <Play size={14} fill="currentColor"/> Run Processing
                  </button>
                  <button onClick={() => activeTab === 'recurring' ? handleOpenModal() : handleOpenBudgetModal()} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-xs font-black shadow-md transition-all active:scale-95">
                      <Plus size={16}/> New {activeTab === 'recurring' ? 'Commitment' : 'Limit'}
                  </button>
              </div>
          </div>
      </div>

      {activeTab === 'recurring' && showFilters && (
        <div className="bg-gray-50 p-4 border border-gray-100 rounded-2xl grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 animate-fade-in shadow-inner shrink-0">
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Payee Search</label>
                <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Type to search..." className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Account</label>
                <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="">All Accounts</option>
                    {sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Category</label>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="">All Categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Type</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="">All Types</option>
                    <option value={TransactionType.EXPENSE}>Expense</option>
                    <option value={TransactionType.INCOME}>Income</option>
                    <option value={TransactionType.TRANSFER}>Transfer</option>
                </select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Min Amount</label>
                <input type="number" value={filterMinAmount} onChange={e => setFilterMinAmount(e.target.value)} placeholder="0.00" className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex items-end">
                <button 
                  onClick={resetFilters}
                  className="w-full flex items-center justify-center gap-2 p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all text-[9px] font-black uppercase tracking-widest border border-dashed border-gray-300"
                >
                    <RotateCcw size={12} /> Reset
                </button>
            </div>
        </div>
      )}

      {activeTab === 'recurring' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="p-3 text-[10px] font-black text-gray-500 uppercase tracking-widest">Next Due</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Accounts</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Payee / Notes</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Category</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Freq</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-right">Amount</th>
                        <th className="p-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-center">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {filteredRecurring.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50/50 group transition-colors">
                            <td className="p-3 text-xs text-gray-600 font-bold whitespace-nowrap">{r.nextDueDate}</td>
                            <td className="p-3 text-[10px] font-bold text-gray-500">
                                {r.type === TransactionType.TRANSFER ? (
                                  <div className="flex items-center gap-1">
                                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded truncate max-w-[80px]">{accounts.find(a=>a.id===r.accountId)?.name}</span>
                                    <ArrowRightLeft size={8} className="text-blue-300"/>
                                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded truncate max-w-[80px]">{accounts.find(a=>a.id===r.toAccountId)?.name}</span>
                                  </div>
                                ) : (
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[120px] inline-block">{accounts.find(a=>a.id===r.accountId)?.name}</span>
                                )}
                            </td>
                            <td className="p-3">
                                <div className="font-bold text-xs text-gray-900 leading-tight">{getPayeeName(r)}</div>
                                {r.notes && <div className="text-[9px] text-gray-400 italic truncate max-w-[200px]">{r.notes}</div>}
                            </td>
                            <td className="p-3">
                                <span className="px-1.5 py-0.5 bg-gray-50 border rounded text-[9px] font-black text-gray-500 uppercase">{r.category}</span>
                            </td>
                            <td className="p-3">
                                <div className="text-[10px] font-bold text-gray-700 flex items-center gap-1.5"><Clock size={10} className="text-brand-500"/> {r.frequency === Frequency.CUSTOM ? `${r.customInterval} ${r.customUnit}` : r.frequency}</div>
                            </td>
                            <td className="p-3 text-right">
                                <div className={`font-black text-xs ${r.type === 'income' ? 'text-green-600' : (r.type === 'transfer' ? 'text-blue-600' : 'text-red-600')}`}>
                                  {r.type === 'income' ? '+' : (r.type === 'transfer' ? '⇄ ' : '-')}{formatCurrency(r.amount, accounts.find(a=>a.id===r.accountId)?.currency)}
                                </div>
                            </td>
                            <td className="p-3 text-center">
                                <div className="flex justify-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onMoveSingle?.(r)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all" title="Post Now"><CheckCircle size={14}/></button>
                                <button onClick={() => handleOpenModal(r)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all"><Edit2 size={14}/></button>
                                <button onClick={() => confirm("Delete commitment?") && onDeleteRecurring(r.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={14}/></button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto pr-2">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categoryBudgets.map(b => {
                    const spentActual = categorySpentCurrentMonth[b.categoryName] || 0;
                    const committedUpcoming = calculateRemainingCommittedSpend(b.categoryName, recurring, transactions);
                    const totalEstimatedSpend = spentActual + committedUpcoming;
                    
                    const effectiveLimit = getEffectiveCategoryBudget(b, transactions);
                    const percentTotal = Math.min(100, (totalEstimatedSpend / effectiveLimit) * 100);
                    const percentActual = Math.min(100, (spentActual / effectiveLimit) * 100);
                    
                    const isOver = totalEstimatedSpend > effectiveLimit;
                    const remainingBudget = Math.max(0, effectiveLimit - totalEstimatedSpend);

                    return (
                        <div key={b.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col justify-between group hover:border-brand-200 transition-all">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-2 h-2 rounded-full bg-brand-500"></div>
                                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Category Budget</div>
                                    </div>
                                    <h4 className="text-xl font-black text-slate-800">{b.categoryName}</h4>
                                </div>
                                <div className="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleOpenBudgetModal(b)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-colors"><Edit2 size={16}/></button>
                                    <button onClick={() => confirm("Delete limit?") && onDeleteCategoryBudget(b.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={16}/></button>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <div className="text-[9px] font-black text-slate-400 uppercase">Actual Spent</div>
                                        <div className="text-lg font-black text-slate-700">{formatCurrency(spentActual)}</div>
                                    </div>
                                    <div className="space-y-1 border-l pl-4 border-slate-100">
                                        <div className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-1">Upcoming <Info size={8}/></div>
                                        <div className="text-lg font-black text-orange-500">{formatCurrency(committedUpcoming)}</div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-end px-1">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Budget Utilization</div>
                                        <div className="text-right">
                                            <span className={`text-sm font-black ${isOver ? 'text-red-600' : 'text-slate-900'}`}>{formatCurrency(totalEstimatedSpend)}</span>
                                            <span className="text-[10px] text-slate-400 font-bold ml-1">/ {Math.round(effectiveLimit)}</span>
                                        </div>
                                    </div>
                                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden relative shadow-inner">
                                        <div 
                                            className="h-full absolute left-0 bg-brand-500 transition-all duration-700 z-20 rounded-full" 
                                            style={{ width: `${percentActual}%` }}
                                        />
                                        <div 
                                            className={`h-full absolute left-0 transition-all duration-700 z-10 rounded-full ${isOver ? 'bg-red-500' : 'bg-orange-300'}`} 
                                            style={{ width: `${percentTotal}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider ${isOver ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                        {isOver ? <AlertTriangle size={12}/> : <CheckCircle size={12}/>}
                                        {isOver ? `${formatCurrency(totalEstimatedSpend - effectiveLimit)} OVER` : `${formatCurrency(remainingBudget)} FREE`}
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Limit Engine</div>
                                        <div className="text-xs font-black text-slate-600">{b.useAverage ? 'Auto-Average' : 'Manual Limit'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {categoryBudgets.length === 0 && (
                    <div className="col-span-full py-16 flex flex-col items-center text-center bg-gray-50 border-4 border-dashed border-gray-100 rounded-[3rem]">
                        <div className="p-6 bg-white rounded-3xl shadow-sm text-slate-300 mb-6"><BarChart3 size={48}/></div>
                        <h4 className="text-xl font-black text-slate-800">No Spend Limits Set</h4>
                        <p className="text-sm text-slate-500 max-w-xs mt-2 font-medium">Add category budgets to track real-time spend plus upcoming commitments automatically.</p>
                        <button onClick={() => handleOpenBudgetModal()} className="mt-8 bg-brand-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-brand-500/20 flex items-center gap-2"><Plus size={20}/> Create First Limit</button>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* Commitment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto border border-slate-100">
            <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center"><h3 className="font-black text-gray-800">{editingId ? 'Edit Commitment' : 'New Commitment'}</h3><button onClick={() => setIsModalOpen(false)} className="text-2xl text-gray-400 hover:text-gray-600 leading-none transition-colors">&times;</button></div>
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Commitment Type</label>
                  <select value={type} onChange={e => setType(e.target.value as any)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                    <option value={TransactionType.EXPENSE}>Expense (-)</option>
                    <option value={TransactionType.INCOME}>Income (+)</option>
                    <option value={TransactionType.TRANSFER}>Transfer (⇄)</option>
                  </select>
                </div>
                <div className="relative" ref={payeeRef}>
                  <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Payee</label>
                  <input 
                    type="text" 
                    required 
                    value={payee} 
                    onChange={e => handlePayeeInputChange(e.target.value)} 
                    onBlur={() => lookupHistoricalCategory(payee)}
                    onFocus={() => payee.length > 0 && setShowPayeeSuggestions(true)}
                    className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 font-bold" 
                    placeholder="e.g. Monthly Rent" 
                  />
                  {showPayeeSuggestions && payeeSuggestions.length > 0 && (
                    <div className="absolute z-[110] w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
                      {payeeSuggestions.map((s, idx) => (
                        <button key={idx} type="button" onClick={() => handleSelectPayeeSuggestion(s)} className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-brand-50 text-gray-700 transition-colors border-b last:border-b-0">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">{type === TransactionType.TRANSFER ? 'Source Account' : 'Account'}</label>
                  <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                    <option value="">Select Account...</option>
                    {sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                  </select>
                </div>
                {type === TransactionType.TRANSFER ? (
                  <div>
                    <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Destination Account</label>
                    <select required value={toAccountId} onChange={e => setToAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                      <option value="">Select Account...</option>
                      {sortedAccounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="relative">
                    <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Category</label>
                    <div className="flex flex-col gap-2">
                        <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                            <option value="">Auto-categorize</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            <option value="Other">+ New Category...</option>
                        </select>
                        {category === 'Other' && (
                            <div className="relative" ref={categoryInputRef}>
                                <input 
                                    type="text" 
                                    placeholder="Type Category Name..." 
                                    value={customCategory} 
                                    onChange={e => handleCategoryInputChange(e.target.value)} 
                                    onFocus={() => customCategory.length > 0 && setShowCategorySuggestions(true)}
                                    className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" 
                                />
                                {showCategorySuggestions && categorySuggestions.length > 0 && (
                                    <div className="absolute z-[110] w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
                                        {categorySuggestions.map((s, idx) => (
                                            <button key={idx} type="button" onClick={() => { setCategory(s); setCustomCategory(''); setShowCategorySuggestions(false); }} className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-brand-50 text-gray-700 transition-colors border-b last:border-b-0">
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                  </div>
                )}
              </div>

              <div><label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm h-16 resize-none outline-none focus:ring-2 focus:ring-brand-500 font-medium" placeholder="Optional details..." /></div>

              <div className="grid grid-cols-2 gap-5">
                 <div><label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Amount</label><input type="number" required value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 font-black" /></div>
                 <div className="opacity-50 pointer-events-none"><label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Installments</label><input type="number" disabled className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none font-bold" placeholder="Infinite" /></div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Frequency</label>
                  <select value={frequency} onChange={e => setFrequency(e.target.value as any)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                    <option value={Frequency.MONTHLY}>Monthly</option>
                    <option value={Frequency.WEEKLY}>Weekly</option>
                    <option value={Frequency.BIWEEKLY}>Bi-Weekly</option>
                    <option value={Frequency.BIMONTHLY}>Every 2 Months</option>
                    <option value={Frequency.QUARTERLY}>Quarterly</option>
                    <option value={Frequency.YEARLY}>Yearly</option>
                    <option value={Frequency.CUSTOM}>Custom...</option>
                  </select>
                </div>
                <div><label className="block text-xs font-black text-gray-500 uppercase mb-1.5 ml-1 tracking-widest">Start Date / Next Due</label><input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 font-bold" /></div>
              </div>

              {frequency === Frequency.CUSTOM && (
                <div className="grid grid-cols-2 gap-5 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-slide-down">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 ml-1 tracking-widest">Interval</label>
                    <input type="number" min="1" value={customInterval} onChange={e => setCustomInterval(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 font-bold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 ml-1 tracking-widest">Unit</label>
                    <select value={customUnit} onChange={e => setCustomUnit(e.target.value as any)} className="w-full p-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 font-bold">
                      <option value="day">Day(s)</option>
                      <option value="week">Week(s)</option>
                      <option value="month">Month(s)</option>
                      <option value="year">Year(s)</option>
                    </select>
                  </div>
                </div>
              )}

              <button type="submit" disabled={isProcessing} className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-xl font-black shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">{isProcessing ? <><RefreshCw size={16} className="animate-spin" /> Saving...</> : 'Save Commitment'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Spend Limits (Budget) Modal */}
      {isBudgetModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-6 border-b bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-black text-gray-800">{editingBudgetId ? 'Edit Spend Limit' : 'New Spend Limit'}</h3>
              <button onClick={() => setIsBudgetModalOpen(false)} className="text-2xl text-gray-400 hover:text-gray-600 leading-none transition-colors">&times;</button>
            </div>
            <form onSubmit={handleSubmitBudget} className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Category</label>
                <select value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-4 focus:ring-brand-500/10">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-4">
                 <div className="flex items-center justify-between px-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Limit Strategy</label>
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setBudgetUseAvg(false)} className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${!budgetUseAvg ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                        <Edit2 size={20}/>
                        <span className="text-[10px] font-black uppercase">Manual Set</span>
                    </button>
                    <button type="button" onClick={() => setBudgetUseAvg(true)} className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${budgetUseAvg ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                        <RefreshCw size={20}/>
                        <span className="text-[10px] font-black uppercase">Auto-Average</span>
                    </button>
                 </div>
              </div>

              {!budgetUseAvg && (
                <div className="animate-fade-in">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Monthly Spending Limit</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    value={budgetLimit} 
                    onChange={e => setBudgetLimit(e.target.value)} 
                    placeholder="0.00" 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-2xl font-black outline-none focus:ring-4 focus:ring-brand-500/10" 
                  />
                </div>
              )}

              {budgetUseAvg && (
                <div className="p-4 bg-blue-50 rounded-2xl flex items-start gap-3 border border-blue-100 animate-fade-in">
                    <Info size={18} className="text-blue-600 shrink-0 mt-0.5"/>
                    <p className="text-[10px] font-bold text-blue-800 leading-relaxed uppercase">
                      Average Strategy Active: The limit will automatically calculate based on your spending history for this category over the last 12 months.
                    </p>
                </div>
              )}

              <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-2xl font-black shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                <Save size={18}/> {editingBudgetId ? 'Update Strategy' : 'Activate Limit'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
