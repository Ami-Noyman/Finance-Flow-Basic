
import React, { useState, useMemo } from 'react';
import { Transaction, TransactionType, Account } from '../types';
import { Plus, Trash2, Search, ArrowUpCircle, ArrowDownCircle, Edit2, ArrowRightLeft, ArrowRight, CheckSquare, Square, Filter, X, Calendar, DollarSign, Repeat, StickyNote, RotateCcw } from 'lucide-react';
import { categorizeTransaction } from '../services/geminiService';
import { formatCurrency } from '../utils/currency';
import { format, subMonths, startOfMonth, parseISO } from 'date-fns';
import { sortAccounts } from '../utils/finance';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: string[];
  selectedAccountId: string | null;
  onAddTransaction: (t: Transaction, makeRecurring?: boolean) => void;
  onEditTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onAddCategory: (category: string) => void;
}

export const TransactionList: React.FC<TransactionListProps> = ({ 
  transactions, 
  accounts, 
  categories, 
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
  
  // Filter States
  const [filterDateFrom, setFilterDateFrom] = useState(defaultStartDate);
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  
  // Form States
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

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const getPayee = (t: any) => t.payee || t.description || '';

  const uniquePayees = useMemo(() => {
    const payeeSet = new Set(transactions.map(getPayee));
    return Array.from(payeeSet).filter(Boolean).sort();
  }, [transactions]);

  const handleOpenModal = (tx?: Transaction) => {
    if (tx) {
      const txAny = tx as any;
      setEditingId(tx.id);
      setAmount(tx.amount.toString());
      setPayee(tx.payee || txAny.description || '');
      setNotes(tx.notes || '');
      setCategory(categories.includes(tx.category) ? tx.category : 'Other');
      if (!categories.includes(tx.category)) setCustomCategory(tx.category);
      setType(tx.type);
      setDate(tx.date);
      setFormAccountId(tx.accountId);
      setToAccountId(tx.toAccountId || '');
      setIsReconciled(tx.isReconciled || false);
      setMakeRecurring(false);
    } else {
      resetForm();
      if (selectedAccountId) setFormAccountId(selectedAccountId);
      else if (sortedAccounts.length > 0) setFormAccountId(sortedAccounts[0].id);
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !payee || !formAccountId) return;
    
    let finalCategory = category === 'Other' ? customCategory : category;
    
    if (type !== TransactionType.TRANSFER && !finalCategory) {
      setIsAutoCategorizing(true);
      finalCategory = await categorizeTransaction(payee, parseFloat(amount), categories);
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
      category: finalCategory || 'Uncategorized',
      type,
      accountId: formAccountId,
      toAccountId: type === TransactionType.TRANSFER ? toAccountId : undefined,
      isReconciled: isReconciled
    };

    if (editingId) onEditTransaction(txData);
    else onAddTransaction(txData, makeRecurring);
    
    resetForm();
    setIsModalOpen(false);
  };

  const resetForm = () => {
    setEditingId(null);
    setAmount('');
    setPayee('');
    setNotes('');
    setCategory('');
    setCustomCategory('');
    setType(TransactionType.EXPENSE);
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setToAccountId('');
    setIsReconciled(false);
    setMakeRecurring(false);
    if (!formAccountId && sortedAccounts.length > 0) setFormAccountId(sortedAccounts[0].id);
  };

  const resetFilters = () => {
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setFilterCategory('');
    setFilterAccount('');
    setSearchTerm('');
  };
  
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(t => {
          const p = getPayee(t);
          if (selectedAccountId && t.accountId !== selectedAccountId && t.toAccountId !== selectedAccountId) return false;
          if (!selectedAccountId && filterAccount) {
               if (t.accountId !== filterAccount && t.toAccountId !== filterAccount) return false;
          }
          if (searchTerm && !p.toLowerCase().includes(searchTerm.toLowerCase())) return false;
          if (filterCategory && t.category !== filterCategory) return false;
          if (filterDateFrom && t.date < filterDateFrom) return false;
          if (filterDateTo && t.date > filterDateTo) return false;
          
          if (filterMinAmount) {
            const min = parseFloat(filterMinAmount);
            if (!isNaN(min) && t.amount < min) return false;
          }
          if (filterMaxAmount) {
            const max = parseFloat(filterMaxAmount);
            if (!isNaN(max) && t.amount > max) return false;
          }
          
          return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, selectedAccountId, filterAccount, searchTerm, filterCategory, filterDateFrom, filterDateTo, filterMinAmount, filterMaxAmount]);

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Unknown';
  const getCurrency = (id: string) => accounts.find(a => a.id === id)?.currency || 'ILS';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-[calc(100vh-6rem)] flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-white">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-xl font-bold text-gray-800 tracking-tight">Transactions</h2>
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-0.5">
                    {selectedAccountId ? `Account: ${getAccountName(selectedAccountId)}` : 'Consolidated View'}
                    <span className="mx-2 text-gray-200">|</span>
                    {filteredTransactions.length} records found
                </p>
            </div>
            
            <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                    type="text" 
                    placeholder="Search by payee..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all bg-gray-50"
                    />
                </div>
                
                <button 
                  onClick={() => setShowFilters(!showFilters)} 
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-black uppercase tracking-wider transition-all shadow-sm ${showFilters ? 'bg-brand-600 border-brand-700 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                    <Filter size={14} />
                    <span className="hidden sm:inline">Filter</span>
                </button>

                <button onClick={() => handleOpenModal()} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition-all whitespace-nowrap shadow-md text-xs font-black uppercase tracking-wider active:scale-95">
                    <Plus size={16} />
                    <span className="hidden sm:inline">New Entry</span>
                </button>
            </div>
        </div>
      </div>

      {showFilters && (
        <div className={`bg-gray-50 p-6 border-b border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 animate-fade-in shadow-inner`}>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date From</label>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date To</label>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Payee</label>
                <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search payee..." className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Account</label>
                <select 
                  value={selectedAccountId || filterAccount} 
                  disabled={!!selectedAccountId}
                  onChange={e => setFilterAccount(e.target.value)} 
                  className={`w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 ${selectedAccountId ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <option value="">All Accounts</option>
                    {sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Category</label>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500">
                    <option value="">All Categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Min Amount</label>
                <input type="number" value={filterMinAmount} onChange={e => setFilterMinAmount(e.target.value)} placeholder="0.00" className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Max Amount</label>
                <input type="number" value={filterMaxAmount} onChange={e => setFilterMaxAmount(e.target.value)} placeholder="9999..." className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex items-end">
                <button 
                  onClick={resetFilters}
                  className="w-full flex items-center justify-center gap-2 p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all text-[10px] font-black uppercase tracking-widest border border-dashed border-gray-300"
                >
                    <RotateCcw size={12} /> Reset
                </button>
            </div>
        </div>
      )}

      <div className="overflow-y-auto flex-1 p-0">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="border-b border-gray-100">
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center w-12">R</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Date</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Account</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Payee</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Notes</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest">Category</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Amount</th>
              <th className="p-4 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredTransactions.map(t => {
               const isTransfer = t.type === TransactionType.TRANSFER;
               const isTransferIn = isTransfer && t.toAccountId === selectedAccountId;
               const isTransferOut = isTransfer && t.accountId === selectedAccountId;
               const p = getPayee(t);
               let displayColor = 'text-gray-900'; let icon = null;
               if (isTransfer) { icon = <ArrowRightLeft size={14} className="text-blue-500" />; if (selectedAccountId) { if (isTransferIn) { displayColor = 'text-green-600'; icon = <ArrowRight size={14} className="text-green-500" />; } else { displayColor = 'text-red-600'; icon = <ArrowRight size={14} className="text-red-500" />; } } else { displayColor = 'text-blue-600'; } } else if (t.type === TransactionType.INCOME) { displayColor = 'text-green-600'; icon = <ArrowUpCircle size={14} className="text-green-500" />; } else { icon = <ArrowDownCircle size={14} className="text-red-500" />; }

               return (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="p-4 text-center"><button onClick={() => onEditTransaction({ ...t, isReconciled: !t.isReconciled })} className={`transition-colors ${t.isReconciled ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}>{t.isReconciled ? <CheckSquare size={16} /> : <Square size={16} />}</button></td>
                    <td className="p-4 text-xs text-gray-600 font-bold whitespace-nowrap">{t.date}</td>
                    <td className="p-4 text-[10px] font-black text-gray-400">{isTransfer ? (<div className="flex items-center gap-1"><span className="bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[80px]">{getAccountName(t.accountId)}</span><span className="text-gray-300">→</span><span className="bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[80px]">{getAccountName(t.toAccountId || '')}</span></div>) : (<span className="bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[120px] inline-block">{getAccountName(t.accountId)}</span>)}</td>
                    <td className="p-4 text-xs font-bold text-gray-900">
                        <div className="flex items-center gap-3">{icon}<span>{p}</span>{t.isRecurring && <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded uppercase tracking-tighter">Recurring</span>}</div>
                    </td>
                    <td className="p-4 text-[10px] text-gray-400 italic max-w-xs truncate font-medium">{t.notes}</td>
                    <td className="p-4 text-xs text-gray-500"><span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-black uppercase tracking-wider text-gray-500 border border-gray-200">{t.category}</span></td>
                    <td className={`p-4 text-sm font-black text-right ${displayColor}`}>{t.type === TransactionType.INCOME || isTransferIn ? '+' : ''}{isTransferOut ? '-' : ''}{formatCurrency(t.amount, getCurrency(isTransferIn ? (t.toAccountId||t.accountId) : t.accountId))}</td>
                    <td className="p-4 text-center"><div className="flex items-center justify-center space-x-2"><button onClick={() => handleOpenModal(t)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all"><Edit2 size={16} /></button><button onClick={() => onDeleteTransaction(t.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button></div></td>
                </tr>
            );})}
            {filteredTransactions.length === 0 && (
                <tr>
                    <td colSpan={8} className="p-20 text-center text-gray-400">
                        <div className="flex flex-col items-center gap-4">
                            <Search size={48} className="opacity-10" />
                            <div className="space-y-1">
                                <p className="text-sm font-black text-gray-800">No transactions match your criteria.</p>
                                <p className="text-xs font-medium">Try adjusting your filters or search term.</p>
                            </div>
                            <button onClick={resetFilters} className="text-xs font-black text-brand-600 hover:underline uppercase tracking-widest mt-2">Clear all filters</button>
                        </div>
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50"><h3 className="font-black text-lg text-gray-800 tracking-tight">{editingId ? 'Edit Entry' : 'New Transaction Entry'}</h3><button onClick={() => setIsModalOpen(false)} className="text-2xl text-gray-400 hover:text-gray-600 leading-none">&times;</button></div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Flow Type</label><select value={type} onChange={e => setType(e.target.value as any)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value={TransactionType.EXPENSE}>Expense (-)</option><option value={TransactionType.INCOME}>Income (+)</option><option value={TransactionType.TRANSFER}>Transfer (⇄)</option></select></div>
                <div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Effective Date</label><input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" /></div>
              </div>
              
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-1"><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Payee / Description</label><input type="text" required list="payee-list" placeholder="e.g. Netflix" value={payee} onChange={e => setPayee(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" /><datalist id="payee-list">{uniquePayees.map(p => <option key={p} value={p} />)}</datalist></div>
                <div className="col-span-1"><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Amount</label><input type="number" step="0.01" required placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-black"/></div>
              </div>

              <div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Internal Notes</label><textarea placeholder="Optional context or memo..." value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm h-16 resize-none focus:ring-2 focus:ring-brand-500 outline-none font-medium text-gray-600"/></div>

              <div className="grid grid-cols-2 gap-5">
                <div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">{type === TransactionType.TRANSFER ? 'Source Account' : 'Account'}</label><select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold">{sortedAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></div>
                {type === TransactionType.TRANSFER && (<div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Destination Account</label><select required value={toAccountId} onChange={e => setToAccountId(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value="">Select Target...</option>{sortedAccounts.filter(a => a.id !== formAccountId).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></div>)}
                {type !== TransactionType.TRANSFER && (<div><label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Category</label><select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none font-bold"><option value="">Auto-categorize</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}<option value="Other">+ New Category...</option></select>{category === 'Other' && (<input type="text" placeholder="Category Name" value={customCategory} onChange={e => setCustomCategory(e.target.value)} className="mt-2 w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-bold" />)}</div>)}
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isReconciled} onChange={e => setIsReconciled(e.target.checked)} className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" /><span className="text-xs font-black text-gray-500 uppercase tracking-widest">Reconciled</span></label>
                {!editingId && (<label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={makeRecurring} onChange={e => setMakeRecurring(e.target.checked)} className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" /><span className="text-xs font-black text-gray-500 uppercase tracking-widest">Make Recurring</span></label>)}
              </div>

              <div className="pt-2"><button type="submit" disabled={isAutoCategorizing} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-black py-3.5 rounded-xl transition-all shadow-lg flex justify-center items-center gap-2 active:scale-95 uppercase tracking-widest text-xs">{isAutoCategorizing ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Categorizing...</> : 'Persist Transaction'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
