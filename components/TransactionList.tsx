
import React, { useState, useMemo, useEffect } from 'react';
import { Transaction, TransactionType, Account, TransactionRule } from '../types';
// Fixed: Added RefreshCw to imports
import { Plus, Trash2, Search, ArrowUpCircle, ArrowDownCircle, Edit2, ArrowRightLeft, ArrowRight, CheckSquare, Square, Filter, X, Calendar, DollarSign, Repeat, StickyNote, RotateCcw, Zap, RefreshCw } from 'lucide-react';
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
  onAddTransaction: (t: Transaction, makeRecurring?: boolean) => void;
  onEditTransaction: (t: Transaction, makeRecurring?: boolean) => void;
  onDeleteTransaction: (id: string) => void;
  onAddCategory: (category: string) => void;
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
  
  const [appliedRuleId, setAppliedRuleId] = useState<string | null>(null);

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !payee || !formAccountId) return;
    
    let finalCategory = category === 'Other' ? customCategory : category;
    
    // If no category selected, use the Smart Learning Engine
    if (type !== TransactionType.TRANSFER && !finalCategory) {
      setIsAutoCategorizing(true);
      finalCategory = await categorizeTransaction(
        payee, 
        parseFloat(amount), 
        transactions, 
        rules, 
        categories
      );
      setIsAutoCategorizing(false);
    } else if (type === TransactionType.TRANSFER) {
        finalCategory = 'Transfer';
    }

    if (category === 'Other' && customCategory) {
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

    if (editingId) onEditTransaction(txData, makeRecurring);
    else onAddTransaction(txData, makeRecurring);
    
    resetForm();
    setIsModalOpen(false);
  };

  const resetForm = () => {
    setEditingId(null); setAmount(''); setPayee(''); setNotes(''); setCategory(''); setCustomCategory(''); setType(TransactionType.EXPENSE); setDate(format(new Date(), 'yyyy-MM-dd')); setToAccountId(''); setIsReconciled(false); setMakeRecurring(false); setAppliedRuleId(null);
    if (!formAccountId && sortedAccounts.length > 0) setFormAccountId(sortedAccounts[0].id);
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-[calc(100vh-6rem)] flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-white shrink-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div><h2 className="text-xl font-bold text-gray-800 tracking-tight">Transactions</h2><p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-0.5">{selectedAccountId ? `Account: ${getAccountName(selectedAccountId)}` : 'Consolidated View'} <span className="mx-2 text-gray-200">|</span> {filteredTransactions.length} records found</p></div>
            <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} /><input type="text" placeholder="Search by payee..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all bg-gray-50"/></div>
                <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-black uppercase tracking-wider transition-all shadow-sm ${showFilters ? 'bg-brand-600 border-brand-700 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}><Filter size={14} /><span className="hidden sm:inline">Filter</span></button>
                <button onClick={() => setIsModalOpen(true)} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition-all whitespace-nowrap shadow-md text-xs font-black uppercase tracking-wider active:scale-95"><Plus size={16} /><span className="hidden sm:inline">New Entry</span></button>
            </div>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-0">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-gray-50 sticky top-0 z-10"><tr className="border-b border-gray-100"><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center w-12">R</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Date</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Account</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Payee</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Category</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Amount</th><th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {filteredTransactions.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="p-4 text-center"><button onClick={() => onEditTransaction({ ...t, isReconciled: !t.isReconciled })} className={`transition-colors ${t.isReconciled ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}>{t.isReconciled ? <CheckSquare size={16} /> : <Square size={16} />}</button></td>
                    <td className="p-4 text-xs text-gray-600 font-bold whitespace-nowrap">{t.date}</td>
                    <td className="p-4 text-[10px] font-black text-gray-400 truncate max-w-[120px]">{getAccountName(t.accountId)}</td>
                    <td className="p-4 text-xs font-bold text-gray-900">{t.payee || (t as any).description}</td>
                    <td className="p-4 text-xs text-gray-500"><span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-black uppercase text-gray-500 border border-gray-200">{t.category}</span></td>
                    <td className={`p-4 text-sm font-black text-right ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(t.amount, getCurrency(t.accountId))}</td>
                    <td className="p-4 text-center"><div className="flex items-center justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => setEditingId(t.id)} className="p-1.5 text-gray-400 hover:text-brand-600"><Edit2 size={16} /></button><button onClick={() => onDeleteTransaction(t.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button></div></td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50"><h3 className="font-black text-lg text-gray-800 tracking-tight">{editingId ? 'Edit Entry' : 'New Transaction Entry'}</h3><button onClick={() => setIsModalOpen(false)} className="text-2xl text-gray-400 hover:text-gray-600 leading-none">&times;</button></div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Flow Type</label><select value={type} onChange={e => setType(e.target.value as any)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value={TransactionType.EXPENSE}>Expense (-)</option><option value={TransactionType.INCOME}>Income (+)</option><option value={TransactionType.TRANSFER}>Transfer (⇄)</option></select></div>
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Effective Date</label><input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" /></div>
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-1"><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Payee</label><input type="text" required placeholder="e.g. Netflix" value={payee} onChange={e => setPayee(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" /></div>
                <div className="col-span-1"><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Amount</label><input type="number" step="0.01" required placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-black"/></div>
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Account</label><select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold">{sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 ml-1">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold">
                        <option value="">Auto-categorize (Learning Mode)</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        <option value="Other">+ New Category...</option>
                    </select>
                </div>
              </div>
              <button type="submit" disabled={isAutoCategorizing} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-black py-3.5 rounded-xl transition-all shadow-lg flex justify-center items-center gap-2 active:scale-95 uppercase tracking-widest text-xs">{isAutoCategorizing ? <RefreshCw size={16} className="animate-spin"/> : 'Persist Transaction'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
