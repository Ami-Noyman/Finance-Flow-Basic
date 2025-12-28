
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Transaction, TransactionType, Account, TransactionRule } from '../types';
import { Plus, Trash2, Search, ArrowUpCircle, ArrowDownCircle, Edit2, ArrowRightLeft, ArrowRight, CheckSquare, Square, Filter, X, Calendar, DollarSign, Repeat, StickyNote, RotateCcw, Zap, RefreshCw, ChevronDown } from 'lucide-react';
import { categorizeTransaction } from '../services/geminiService';
import { formatCurrency } from '../utils/currency';
import { format, subMonths, startOfMonth, parseISO } from 'date-fns';
import { sortAccounts } from '../utils/finance';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: string[];
  rules: TransactionRule[];
  selectedAccountId: string | null;
  onAddTransaction: (t: Transaction, makeRecurring?: boolean) => Promise<void>;
  onAddCategory: (category: string) => void;
  onEditTransaction: (t: Transaction, makeRecurring?: boolean) => Promise<void>;
  onDeleteTransaction: (id: string) => Promise<void>;
}

export const TransactionList: React.FC<TransactionListProps> = ({ 
  transactions, 
  accounts, 
  categories,
  rules,
  selectedAccountId, 
  onAddTransaction, 
  onEditTransaction, 
  onDeleteTransaction,
  onAddCategory
}) => {
  const defaultStartDate = useMemo(() => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'), []);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  const [filterDateFrom, setFilterDateFrom] = useState(defaultStartDate);
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [type, setType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formAccountId, setFormAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [isAutoCategorizing, setIsAutoCategorizing] = useState(false);
  const [isReconciled, setIsReconciled] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);

  // Type-ahead states
  const [payeeSuggestions, setPayeeSuggestions] = useState<string[]>([]);
  const [showPayeeSuggestions, setShowPayeeSuggestions] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  
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

    // Then history
    const matches = transactions.filter(t => (t.payee || (t as any).description || '').toLowerCase().trim() === normalized);
    if (matches.length > 0) {
      const counts: Record<string, number> = {};
      matches.forEach(m => counts[m.category] = (counts[m.category] || 0) + 1);
      const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      
      if (categories.includes(topCategory)) {
        setCategory(topCategory);
        setCustomCategory('');
      } else {
        setCategory('Other');
        setCustomCategory(topCategory);
      }
    }
  };

  const handlePayeeChange = (value: string) => {
    setPayee(value);
    if (value.length > 0) {
      const payeesMapped = transactions.map(t => (t.payee || (t as any).description || '') as string).filter(p => !!p);
      const distinct: string[] = Array.from(new Set<string>(payeesMapped));
      const filtered = distinct.filter(p => p.toLowerCase().includes(value.toLowerCase())).slice(0, 5);
      setPayeeSuggestions(filtered);
      setShowPayeeSuggestions(true);
    } else {
      setShowPayeeSuggestions(false);
    }
  };

  const handleSelectPayee = (selectedPayee: string) => {
    setPayee(selectedPayee);
    setShowPayeeSuggestions(false);
    lookupHistoricalCategory(selectedPayee);
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

  const openNew = () => {
    resetForm();
    // Default to first account or current filter
    const defaultAcc = selectedAccountId || (sortedAccounts.length > 0 ? sortedAccounts[0].id : '');
    setFormAccountId(defaultAcc);
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !payee || !formAccountId) return;
    
    let finalCategory = category === 'Other' ? customCategory : category;
    
    // AI only activates here IF category is still blank
    if (type !== TransactionType.TRANSFER && !finalCategory) {
      setIsAutoCategorizing(true);
      finalCategory = await categorizeTransaction(payee, parseFloat(amount), transactions, rules, categories);
      setIsAutoCategorizing(false);
    } else if (type === TransactionType.TRANSFER) {
        finalCategory = 'Transfer';
    }

    if (category === 'Other' && customCategory && !categories.includes(customCategory)) {
        onAddCategory(customCategory);
    }

    const txData: Transaction = {
      id: editingId || crypto.randomUUID(),
      date,
      amount: parseFloat(amount),
      payee,
      notes: notes.trim() || undefined,
      category: finalCategory || 'כללי',
      type,
      accountId: formAccountId,
      toAccountId: type === TransactionType.TRANSFER ? toAccountId : undefined,
      isReconciled: isReconciled
    };

    if (editingId) await onEditTransaction(txData, makeRecurring);
    else await onAddTransaction(txData, makeRecurring);
    
    resetForm();
    setIsModalOpen(false);
  };

  const resetForm = () => {
    setEditingId(null); setAmount(''); setPayee(''); setNotes(''); setCategory(''); setCustomCategory(''); setType(TransactionType.EXPENSE); setDate(format(new Date(), 'yyyy-MM-dd')); setToAccountId(''); setIsReconciled(false); setMakeRecurring(false);
    setPayeeSuggestions([]); setShowPayeeSuggestions(false);
    setCategorySuggestions([]); setShowCategorySuggestions(false);
  };

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(t => {
          const p = t.payee || (t as any).description || '';
          if (selectedAccountId && t.accountId !== selectedAccountId && t.toAccountId !== selectedAccountId) return false;
          if (!selectedAccountId && filterAccount) if (t.accountId !== filterAccount && t.toAccountId !== filterAccount) return false;
          if (searchTerm && !p.toLowerCase().includes(searchTerm.toLowerCase())) return false;
          if (filterCategory && t.category !== filterCategory) return false;
          if (filterDateFrom && t.date < filterDateFrom) return false;
          if (filterDateTo && t.date > filterDateTo) return false;
          if (filterMinAmount && t.amount < parseFloat(filterMinAmount)) return false;
          if (filterMaxAmount && t.amount > parseFloat(filterMaxAmount)) return false;
          return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, selectedAccountId, filterAccount, searchTerm, filterCategory, filterDateFrom, filterDateTo, filterMinAmount, filterMaxAmount]);

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Unknown';
  const getCurrency = (id: string) => accounts.find(a => a.id === id)?.currency || 'ILS';

  const openEdit = (t: Transaction) => {
    setEditingId(t.id);
    setAmount(t.amount.toString());
    setPayee(t.payee || (t as any).description || '');
    setType(t.type);
    setDate(t.date);
    setFormAccountId(t.accountId);
    setToAccountId(t.toAccountId || '');
    setNotes(t.notes || '');
    if (categories.includes(t.category)) {
      setCategory(t.category);
      setCustomCategory('');
    } else if (t.category !== 'Transfer') {
      setCategory('Other');
      setCustomCategory(t.category);
    }
    setIsReconciled(t.isReconciled || false);
    setIsModalOpen(true);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-[calc(100vh-6rem)] flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-white shrink-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800 tracking-tight">Transactions</h2>
              <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-0.5">
                {selectedAccountId ? `Account: ${getAccountName(selectedAccountId)}` : 'Consolidated View'} 
                <span className="mx-2 text-gray-200">|</span> 
                {filteredTransactions.length} records
              </p>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                  <input type="text" placeholder="Search payee..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all bg-gray-50"/>
                </div>
                <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-black uppercase tracking-wider transition-all shadow-sm ${showFilters ? 'bg-brand-600 border-brand-700 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  <Filter size={14} />
                  <span className="hidden sm:inline">Filter</span>
                </button>
                <button onClick={openNew} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition-all whitespace-nowrap shadow-md text-xs font-black uppercase tracking-wider active:scale-95">
                  <Plus size={16} />
                  <span className="hidden sm:inline">New Entry</span>
                </button>
            </div>
        </div>

        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-100 rounded-xl grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 animate-fade-in shadow-inner">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Date From</label>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Date To</label>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Category</label>
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white">
                <option value="">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {!selectedAccountId && (
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Account</label>
                <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white">
                  <option value="">All Accounts</option>
                  {sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Min Amount</label>
              <input type="number" value={filterMinAmount} onChange={e => setFilterMinAmount(e.target.value)} placeholder="0.00" className="w-full p-2 border border-gray-200 rounded-lg text-xs" />
            </div>
            <div className="flex items-end">
              <button 
                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterCategory(''); setFilterAccount(''); setFilterMinAmount(''); setFilterMaxAmount(''); }}
                className="w-full py-2 px-3 text-gray-500 hover:text-red-600 text-[10px] font-black uppercase tracking-widest border border-dashed border-gray-300 rounded-lg flex items-center justify-center gap-2"
              >
                <RotateCcw size={12}/> Reset
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-y-auto flex-1 p-0">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-gray-50 sticky top-0 z-10"><tr className="border-b border-gray-100"><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center w-12">R</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Date</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Account</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Payee</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Category</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Amount</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {filteredTransactions.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/50 group transition-colors">
                    <td className="p-4 text-center"><button onClick={() => onEditTransaction({ ...t, isReconciled: !t.isReconciled })} className={`transition-colors ${t.isReconciled ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}>{t.isReconciled ? <CheckSquare size={16} /> : <Square size={16} />}</button></td>
                    <td className="p-4 text-xs text-gray-600 font-bold whitespace-nowrap">{t.date}</td>
                    <td className="p-4 text-[10px] font-black text-gray-400 truncate max-w-[120px]">{getAccountName(t.accountId)}</td>
                    <td className="p-4 text-xs font-bold text-gray-900">{t.payee || (t as any).description}</td>
                    <td className="p-4 text-xs text-gray-500"><span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-black uppercase text-gray-500 border border-gray-200">{t.category}</span></td>
                    <td className={`p-4 text-sm font-black text-right ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(t.amount, getCurrency(t.accountId))}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-brand-600"><Edit2 size={16} /></button>
                        <button onClick={() => confirm("Delete entry?") && onDeleteTransaction(t.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                      </div>
                    </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50"><h3 className="font-black text-lg text-gray-800 tracking-tight">{editingId ? 'Edit Entry' : 'New Transaction Entry'}</h3><button onClick={() => setIsModalOpen(false)} className="text-2xl text-gray-400 hover:text-gray-600 leading-none">&times;</button></div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Flow Type</label><select value={type} onChange={e => setType(e.target.value as any)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value={TransactionType.EXPENSE}>Expense (-)</option><option value={TransactionType.INCOME}>Income (+)</option><option value={TransactionType.TRANSFER}>Transfer (⇄)</option></select></div>
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Effective Date</label><input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" /></div>
              </div>
              
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-1 relative" ref={payeeRef}>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Payee</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. Netflix" 
                    value={payee} 
                    onChange={e => handlePayeeChange(e.target.value)} 
                    onBlur={() => lookupHistoricalCategory(payee)}
                    onFocus={() => payee.length > 0 && setShowPayeeSuggestions(true)}
                    className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" 
                  />
                  {showPayeeSuggestions && payeeSuggestions.length > 0 && (
                    <div className="absolute z-[110] w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
                      {payeeSuggestions.map((s, idx) => (
                        <button key={idx} type="button" onClick={() => handleSelectPayee(s)} className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-brand-50 text-gray-700 transition-colors border-b last:border-b-0">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-1"><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Amount</label><input type="number" step="0.01" required placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-black"/></div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Account</label><select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold">{sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div className="relative">
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Category</label>
                    <div className="flex flex-col gap-2">
                        <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold">
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
              </div>

              {type === TransactionType.TRANSFER && (
                <div className="animate-fade-in"><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">To Account</label><select required value={toAccountId} onChange={e => setToAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value="">Select Destination...</option>{sortedAccounts.filter(a => a.id !== formAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              )}

              <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Notes (Optional)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Transaction details..." className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-medium h-16 resize-none" /></div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div onClick={() => setIsReconciled(!isReconciled)} className={`w-10 h-5 rounded-full transition-all relative ${isReconciled ? 'bg-green-500' : 'bg-gray-200'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${isReconciled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Reconciled (R)</span>
                </label>
                
                {!editingId && (
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div onClick={() => setMakeRecurring(!makeRecurring)} className={`w-10 h-5 rounded-full transition-all relative ${makeRecurring ? 'bg-brand-600' : 'bg-gray-200'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${makeRecurring ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Make Recurring</span>
                  </label>
                )}
              </div>

              <button type="submit" disabled={isAutoCategorizing} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-black py-4 rounded-xl transition-all shadow-lg flex justify-center items-center gap-2 active:scale-95 uppercase tracking-widest text-xs">{isAutoCategorizing ? <RefreshCw size={16} className="animate-spin"/> : 'Persist Transaction'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
