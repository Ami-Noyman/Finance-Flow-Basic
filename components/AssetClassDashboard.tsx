
import React, { useMemo, useState, useEffect } from 'react';
import { Account, Transaction, TransactionType, Valuation } from '../types';
import { 
    BarChart, Bar, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, 
    ResponsiveContainer, Cell, LabelList, Legend, Line, ComposedChart, LineChart
} from 'recharts';
import { formatCurrency } from '../utils/currency';
import { 
    TrendingUp, CalendarDays, PieChart, BarChart3, Info, Plus, 
    History, ArrowLeft, Target, DollarSign, Activity, Trash2, Edit2, ArrowUpRight, ArrowDownRight, User, X, Save, Users, Filter, Check, Layers, ShieldCheck
} from 'lucide-react';
import { 
    subMonths, endOfMonth, format, parseISO, getYear, startOfMonth, 
    isAfter, isBefore, isSameMonth, startOfYear, eachMonthOfInterval 
} from 'date-fns';

interface AssetClassDashboardProps {
  title: string;
  accountType: string; 
  accounts: Account[];
  transactions: Transaction[];
  valuations: Valuation[];
  onSaveValuation: (v: Valuation) => void;
  onDeleteValuation: (id: string) => void;
  icon: React.ElementType;
}

const OWNER_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#f97316'];

export const AssetClassDashboard: React.FC<AssetClassDashboardProps> = ({ 
  title, 
  accountType, 
  accounts, 
  transactions,
  valuations,
  onSaveValuation,
  onDeleteValuation,
  icon: Icon
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(getYear(new Date()));
  const [showValuationModal, setShowValuationModal] = useState(false);
  const [visibleOwners, setVisibleOwners] = useState<string[]>([]);
  
  // Valuation Form State
  const [valDate, setValDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [valAmount, setValAmount] = useState('');

  const targetAccounts = useMemo(() => accounts.filter(a => a.type === accountType), [accounts, accountType]);
  const activeAccount = useMemo(() => targetAccounts.find(a => a.id === selectedAccountId), [targetAccounts, selectedAccountId]);
  const displayCurrency = activeAccount?.currency || accounts[0]?.currency || 'ILS';

  // Accumulated Pension Calculation
  const totalPensionSum = useMemo(() => {
    if (accountType !== 'pension') return 0;
    return targetAccounts.reduce((sum, acc) => sum + (acc.estimatedPension || 0), 0);
  }, [targetAccounts, accountType]);

  // --- Grouping and Aggregation by Owner ---
  const accountsByOwner = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    
    targetAccounts.forEach(acc => {
        const ownerName = acc.owner || 'General';
        if (!grouped[ownerName]) grouped[ownerName] = [];

        // Calculate current balance
        const accountVals = valuations.filter(v => v.accountId === acc.id).sort((x, y) => y.date.localeCompare(x.date));
        const latestVal = accountVals[0]?.value;

        let ledgerBalance = acc.initialBalance || 0;
        transactions.forEach(t => {
            if (t.accountId === acc.id) {
                if (t.type === TransactionType.INCOME) ledgerBalance += t.amount;
                else ledgerBalance -= t.amount;
            }
            if (t.toAccountId === acc.id) ledgerBalance += t.amount;
        });

        grouped[ownerName].push({
            ...acc,
            currentBalance: latestVal !== undefined ? latestVal : ledgerBalance
        });
    });

    return Object.entries(grouped).map(([owner, accs], idx) => ({
        owner,
        accounts: accs,
        totalBalance: accs.reduce((sum, a) => sum + a.currentBalance, 0),
        color: OWNER_COLORS[idx % OWNER_COLORS.length]
    })).sort((a, b) => b.totalBalance - a.totalBalance);
  }, [targetAccounts, valuations, transactions]);

  // Sync visible owners with available owners initially
  useEffect(() => {
    if (visibleOwners.length === 0 && accountsByOwner.length > 0) {
      setVisibleOwners(accountsByOwner.map(o => o.owner));
    }
  }, [accountsByOwner]);

  const totalPortfolioValue = useMemo(() => accountsByOwner.reduce((sum, o) => sum + o.totalBalance, 0), [accountsByOwner]);

  // --- Historical Growth Data per Owner ---
  const ownerMonthlyGrowthData = useMemo(() => {
    const today = new Date();
    const startDate = subMonths(today, 24); // Show 2 years
    const months = eachMonthOfInterval({ start: startDate, end: today });
    
    return months.map(m => {
        const dateStr = format(endOfMonth(m), 'yyyy-MM-dd');
        const dataPoint: any = { 
            name: format(m, 'MMM yy'),
            dateObj: m
        };

        accountsByOwner.forEach(group => {
            let groupTotalAtPoint = 0;
            group.accounts.forEach((acc: any) => {
                const accountValsAtPoint = valuations
                    .filter(v => v.accountId === acc.id && v.date <= dateStr)
                    .sort((x, y) => y.date.localeCompare(x.date));

                if (accountValsAtPoint.length > 0) {
                    groupTotalAtPoint += accountValsAtPoint[0].value;
                } else {
                    let bal = acc.initialBalance || 0;
                    transactions.forEach(t => {
                        if (t.date <= dateStr) {
                            if (t.accountId === acc.id) {
                                if (t.type === TransactionType.INCOME) bal += t.amount;
                                else bal -= t.amount;
                            }
                            if (t.toAccountId === acc.id) bal += t.amount;
                        }
                    });
                    groupTotalAtPoint += bal;
                }
            });
            dataPoint[group.owner] = groupTotalAtPoint;
        });

        return dataPoint;
    });
  }, [accountsByOwner, valuations, transactions]);

  // --- Account Specific Metrics for Drill-down ---
  const accountMetrics = useMemo(() => {
    if (!activeAccount) return null;

    const accId = activeAccount.id;
    const accValuations = valuations.filter(v => v.accountId === accId).sort((a, b) => a.date.localeCompare(b.date));
    const accTransactions = transactions.filter(t => t.accountId === accId || t.toAccountId === accId);
    
    const latestValuation = accValuations[accValuations.length - 1]?.value;
    
    let costBasis = activeAccount.initialBalance;
    accTransactions.forEach(t => {
        if (t.type === TransactionType.TRANSFER) {
            if (t.toAccountId === accId) costBasis += t.amount;
            else if (t.accountId === accId) costBasis -= t.amount;
        }
    });

    const currentVal = latestValuation !== undefined ? latestValuation : costBasis;
    const totalProfit = currentVal - costBasis;
    const profitPercent = costBasis !== 0 ? (totalProfit / costBasis) * 100 : 0;

    const startOfThisYear = format(startOfYear(new Date()), 'yyyy-MM-dd');
    const valAtStartOfYear = accValuations.find(v => v.date <= startOfThisYear)?.value || activeAccount.initialBalance;
    const netDepositsYTD = accTransactions.filter(t => t.date >= startOfThisYear && t.type === TransactionType.TRANSFER)
                                         .reduce((sum, t) => t.toAccountId === accId ? sum + t.amount : sum - t.amount, 0);
    const profitYTD = currentVal - (valAtStartOfYear + netDepositsYTD);
    const profitYTDPercent = (valAtStartOfYear + netDepositsYTD) !== 0 ? (profitYTD / (valAtStartOfYear + netDepositsYTD)) * 100 : 0;

    return {
        currentVal,
        costBasis,
        totalProfit,
        profitPercent,
        profitYTD,
        profitYTDPercent,
        history: accValuations.slice().reverse()
    };
  }, [activeAccount, valuations, transactions]);

  const individualTrendData = useMemo(() => {
    if (!activeAccount) return [];
    
    const accId = activeAccount.id;
    const today = new Date();
    const startDate = subMonths(today, 24); 
    const months = eachMonthOfInterval({ start: startDate, end: today });
    
    const accValuations = valuations.filter(v => v.accountId === accId).sort((a, b) => a.date.localeCompare(b.date));
    const accTransactions = transactions.filter(t => t.accountId === accId || t.toAccountId === accId);

    return months.map(m => {
        const dateStr = format(endOfMonth(m), 'yyyy-MM-dd');
        
        let basisAtPoint = activeAccount.initialBalance;
        accTransactions.forEach(t => {
            if (t.date <= dateStr && t.type === TransactionType.TRANSFER) {
                if (t.toAccountId === accId) basisAtPoint += t.amount;
                else if (t.accountId === accId) basisAtPoint -= t.amount;
            }
        });

        const valuationAtPoint = [...accValuations].reverse().find(v => v.date <= dateStr)?.value;

        return {
            date: format(m, 'MMM yy'),
            marketValue: valuationAtPoint !== undefined ? valuationAtPoint : basisAtPoint,
            costBasis: basisAtPoint
        };
    });
  }, [activeAccount, valuations, transactions]);

  // --- Handlers ---
  const handleLogValuation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAccount || !valAmount) return;
    
    const newValuation: Valuation = {
        id: crypto.randomUUID(),
        accountId: activeAccount.id,
        date: valDate,
        value: parseFloat(valAmount)
    };
    onSaveValuation(newValuation);
    setShowValuationModal(false);
    setValAmount('');
  };

  const toggleOwnerVisibility = (owner: string) => {
    setVisibleOwners(prev => 
      prev.includes(owner) ? prev.filter(o => o !== owner) : [...prev, owner]
    );
  };

  const tooltipStyle = { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '16px', zIndex: 1000 };
  const tooltipItemStyle = { fontSize: '13px', fontWeight: 700 };
  const tooltipLabelStyle = { color: '#64748b', fontSize: '11px', fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase' };

  if (selectedAccountId && activeAccount && accountMetrics) {
    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <button onClick={() => setSelectedAccountId(null)} className="flex items-center gap-2 text-slate-500 hover:text-brand-600 font-bold transition-colors">
                <ArrowLeft size={18}/> Back to Portfolio Overview
            </button>

            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-brand-50 text-brand-600 rounded-2xl" style={{ color: activeAccount.color }}><Icon size={32} /></div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-black text-slate-800 tracking-tight">{activeAccount.name}</h2>
                            {activeAccount.owner && <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg font-black uppercase tracking-widest flex items-center gap-1"><User size={10}/> {activeAccount.owner}</span>}
                            {activeAccount.subType && <span className="text-[10px] px-2 py-0.5 bg-brand-50 text-brand-600 rounded-lg font-black uppercase tracking-widest">{activeAccount.subType}</span>}
                        </div>
                        <p className="text-sm text-slate-500 font-medium">Track: {activeAccount.investmentTrack || 'General Market'}</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <button onClick={() => setShowValuationModal(true)} className="bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg transition-all active:scale-95">
                        <Plus size={20}/> Log Current Valuation
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Current Valuation</p>
                    <h4 className="text-2xl font-black text-slate-900">{formatCurrency(accountMetrics.currentVal, displayCurrency)}</h4>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Updated: {accountMetrics.history[0]?.date || 'Never'}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Gain / Loss</p>
                    <div className={`flex items-center gap-1.5 font-black text-2xl ${accountMetrics.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {accountMetrics.totalProfit >= 0 ? <ArrowUpRight size={24}/> : <ArrowDownRight size={24}/>}
                        {formatCurrency(Math.abs(accountMetrics.totalProfit), displayCurrency)}
                    </div>
                    <p className={`text-xs font-bold mt-1 ${accountMetrics.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {accountMetrics.profitPercent >= 0 ? '+' : ''}{accountMetrics.profitPercent.toFixed(2)}% Return
                    </p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">YTD Performance</p>
                    <div className={`flex items-center gap-1.5 font-black text-xl ${accountMetrics.profitYTD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(accountMetrics.profitYTD, displayCurrency)}
                    </div>
                    <p className={`text-xs font-bold mt-1 ${accountMetrics.profitYTD >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {accountMetrics.profitYTDPercent >= 0 ? '+' : ''}{accountMetrics.profitYTDPercent.toFixed(2)}% YTD
                    </p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Invested (Basis)</p>
                    <h4 className="text-2xl font-black text-slate-700">{formatCurrency(accountMetrics.costBasis, displayCurrency)}</h4>
                    <p className="text-xs text-slate-400 mt-1 font-medium">Net principal deposits</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-2"><Activity size={20} className="text-brand-500"/> Performance Trend</h3>
                    <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={individualTrendData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{fontSize: 11, fontWeight: 700, fill: '#64748b'}} axisLine={false} tickLine={false} interval={2} />
                                <YAxis tick={{fontSize: 11, fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val} />
                                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle}
                                    formatter={(val: number, name: string) => [formatCurrency(val, displayCurrency), name === 'marketValue' ? 'Market Value' : 'Cost Basis']}
                                />
                                <Legend verticalAlign="top" iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />
                                <Area type="monotone" dataKey="marketValue" name="Market Value" fill={activeAccount.color} fillOpacity={0.05} stroke={activeAccount.color} strokeWidth={4} />
                                <Line type="monotone" dataKey="costBasis" name="Cost Basis" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col">
                    <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2"><History size={20} className="text-brand-500"/> Valuation Log</h3>
                    <div className="flex-1 overflow-auto space-y-3 pr-2">
                        {accountMetrics.history.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center py-12">
                                <History size={48} className="opacity-10 mb-2" />
                                <p className="text-sm font-bold">No valuation history</p>
                            </div>
                        ) : (
                            accountMetrics.history.map((v, i) => {
                                const nextV = accountMetrics.history[i+1];
                                const diff = nextV ? v.value - nextV.value : 0;
                                const diffPct = nextV ? (diff / nextV.value) * 100 : 0;

                                return (
                                    <div key={v.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="text-[10px] font-black text-slate-400 uppercase">{v.date}</div>
                                                <div className="text-lg font-black text-slate-900">{formatCurrency(v.value, displayCurrency)}</div>
                                            </div>
                                            <button onClick={() => onDeleteValuation(v.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                                                <Trash2 size={16}/>
                                            </button>
                                        </div>
                                        {nextV && (
                                            <div className={`text-[10px] font-black flex items-center gap-1 ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {diff >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
                                                {diffPct.toFixed(2)}% ({formatCurrency(Math.abs(diff), displayCurrency)})
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Manual Valuation Modal */}
            {showValuationModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-slate-100">
                        <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                            <div>
                                <h3 className="font-black text-xl text-slate-900">Log New Valuation</h3>
                                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">{activeAccount.name}</p>
                            </div>
                            <button onClick={() => setShowValuationModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleLogValuation} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5">Valuation Date</label>
                                    <input type="date" value={valDate} onChange={e => setValDate(e.target.value)} required className="w-full p-4 bg-slate-50 border rounded-2xl text-sm font-black focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5">Market Value ({displayCurrency})</label>
                                    <input type="number" step="0.01" value={valAmount} onChange={e => setValAmount(e.target.value)} required placeholder="0.00" autoFocus className="w-full p-4 bg-slate-50 border rounded-2xl text-2xl font-black focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                                </div>
                            </div>
                            
                            <div className="p-4 bg-orange-50 rounded-2xl flex items-start gap-3">
                                <Info size={16} className="text-orange-600 shrink-0 mt-0.5"/>
                                <p className="text-[10px] font-bold text-orange-800 leading-relaxed">
                                    Updating the market value will not create a transaction. It adjusts the portfolio valuation to reflect market growth or decline.
                                </p>
                            </div>

                            <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-2xl font-black shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2">
                                <Save size={20}/> Save Valuation Snapshot
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
  }

  return (
    <div className="space-y-12 animate-fade-in pb-12">
      {/* 1. Header and Overall Summary */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5">
              <div className="p-5 bg-brand-50 text-brand-600 rounded-3xl shadow-inner"><Icon size={36} /></div>
              <div><h2 className="text-3xl font-black text-slate-800 tracking-tight">{title} Portfolio</h2><p className="text-base text-slate-500 font-medium">Tracking long-term asset accumulation</p></div>
          </div>
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            {accountType === 'pension' && (
                <div className="text-center md:text-right bg-brand-600 text-white p-6 rounded-3xl min-w-[280px] shadow-xl border border-brand-500 flex flex-col justify-center">
                    <p className="text-[10px] text-brand-100 font-black uppercase tracking-widest mb-1 flex items-center justify-center md:justify-end gap-2">
                        <ShieldCheck size={14}/> Accrued Monthly Pension
                    </p>
                    <span className="text-3xl font-black tracking-tighter">{formatCurrency(totalPensionSum, displayCurrency)}</span>
                </div>
            )}
            <div className="text-center md:text-right bg-slate-900 text-white p-6 rounded-3xl min-w-[280px] shadow-xl flex flex-col justify-center">
                <p className="text-[10px] text-brand-400 font-black uppercase tracking-widest mb-1">Portfolio Total Assets</p>
                <span className="text-4xl font-black tracking-tighter">{formatCurrency(totalPortfolioValue, displayCurrency)}</span>
            </div>
          </div>
      </div>

      {/* 2. Portfolio Allocation Chart */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-2"><PieChart size={20} className="text-brand-500"/>Portfolio Allocation by Owner</h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={accountsByOwner}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="owner" tick={{fontSize: 12, fontWeight: 700, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val} tick={{fontSize: 11, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle}
                      formatter={(value: number, name: any, props: any) => [formatCurrency(value, displayCurrency), props.payload.owner]} 
                    />
                    <Bar dataKey="totalBalance" radius={[12, 12, 0, 0]} barSize={80} name="Total Portfolio Value">
                        <LabelList 
                            dataKey="totalBalance" 
                            position="top" 
                            formatter={(val: number) => formatCurrency(val, displayCurrency)}
                            style={{ fontSize: '10px', fontWeight: 'bold', fill: '#64748b' }}
                        />
                        {accountsByOwner.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
          </div>
      </div>

      {/* 3. Gains Tracking Chart */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
         <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
            <div>
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><TrendingUp size={22} className="text-brand-500"/> Gains Tracking (By Owner)</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Portfolio growth across all assets over the last 24 months</p>
            </div>
            
            {/* Owner Filter Controls */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-2 px-2 border-r border-slate-200 mr-1 py-1">
                    <Filter size={14} className="text-slate-400"/>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter Owners</span>
                </div>
                {accountsByOwner.map(group => (
                    <button 
                        key={group.owner}
                        onClick={() => toggleOwnerVisibility(group.owner)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all flex items-center gap-2 border ${
                            visibleOwners.includes(group.owner) 
                            ? 'bg-white border-slate-200 text-slate-800 shadow-sm' 
                            : 'bg-transparent border-transparent text-slate-400 opacity-60 hover:opacity-100'
                        }`}
                    >
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: visibleOwners.includes(group.owner) ? group.color : '#cbd5e1' }} />
                        {group.owner}
                        {visibleOwners.includes(group.owner) && <Check size={10} className="text-brand-500" />}
                    </button>
                ))}
            </div>
         </div>
         
         <div className="h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ownerMonthlyGrowthData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{fontSize: 11, fontWeight: 700, fill: '#64748b'}} axisLine={false} tickLine={false} interval={2} />
                    <YAxis tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val} tick={{fontSize: 11, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle}
                        formatter={(val: number, name: string) => [formatCurrency(val, displayCurrency), name]}
                    />
                    <Legend verticalAlign="top" iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />
                    {accountsByOwner.filter(g => visibleOwners.includes(g.owner)).map((group, i) => (
                        <Line 
                            key={group.owner} 
                            type="monotone" 
                            dataKey={group.owner} 
                            stroke={group.color} 
                            strokeWidth={4} 
                            dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            name={group.owner} 
                            animationDuration={800}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
         </div>
      </div>

      {/* 4. Detailed Portfolio Hierarchy (Groups of saving accounts by owner) */}
      <div className="space-y-6">
          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2 px-2"><Layers size={20} className="text-brand-500"/> Portfolio Hierarchy Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {accountsByOwner.map(group => (
                  <div key={group.owner} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-md space-y-4">
                      <div className="flex items-center gap-2 px-1 border-b border-slate-100 pb-3">
                          <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: group.color }} />
                          <span className="text-xs font-black text-slate-800 uppercase tracking-widest">{group.owner} Assets</span>
                          <span className="text-[10px] text-slate-400 font-bold ml-auto">{formatCurrency(group.totalBalance, displayCurrency)}</span>
                      </div>
                      <div className="space-y-2">
                          {group.accounts.map((acc: any) => (
                              <div key={acc.id} onClick={() => setSelectedAccountId(acc.id)} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:border-brand-500 hover:bg-white transition-all cursor-pointer group shadow-sm">
                                  <div className="flex justify-between items-center">
                                      <div>
                                          <div className="text-xs font-black text-slate-900 group-hover:text-brand-600 transition-colors">{acc.name}</div>
                                          <div className="text-[10px] text-slate-400 font-bold uppercase">{acc.subType || 'General'}</div>
                                      </div>
                                      <div className="text-right">
                                          <div className="text-sm font-black text-slate-900">{formatCurrency(acc.currentBalance, displayCurrency)}</div>
                                          <div className="text-[9px] text-brand-600 font-black">Weight: {((acc.currentBalance / group.totalBalance) * 100).toFixed(0)}%</div>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              ))}
          </div>
      </div>
    </div>
  );
};
