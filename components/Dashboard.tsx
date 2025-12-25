
import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Cell, ReferenceLine, LabelList, AreaChart, Area
} from 'recharts';
import { Transaction, TransactionType, Account, RecurringTransaction, SmartCategoryBudget, FinancialGoal, BalanceAlert } from '../types';
import { TrendingUp, TrendingDown, Activity, Wallet, Zap, Info, AlertCircle, Target, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, X } from 'lucide-react';
import { formatCurrency } from '../utils/currency';
import { addDays, format, parseISO, startOfDay, subDays, isSameDay, startOfMonth, endOfMonth, isWithinInterval, subMonths } from 'date-fns';
import { calculateNextDate, getSmartAmount, sortAccounts, calculateBalanceAlerts } from '../utils/finance';
import { analyzeAnomalies } from '../services/geminiService';

const DISMISSED_ALERTS_KEY = 'financeflow_dismissed_alerts';

interface DashboardProps {
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  categoryBudgets: SmartCategoryBudget[];
  accounts: Account[];
  goals: FinancialGoal[];
  selectedAccountId: string | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ transactions, recurring, categoryBudgets, accounts, goals, selectedAccountId }) => {
  const [showIndividualLines, setShowIndividualLines] = useState(true);
  const [anomalies, setAnomalies] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Initialize dismissed alerts from localStorage for persistence
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(() => {
    const stored = localStorage.getItem(DISMISSED_ALERTS_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    if (transactions.length > 0) {
      setIsAnalyzing(true);
      analyzeAnomalies(transactions).then(res => {
        setAnomalies(res);
        setIsAnalyzing(false);
      });
    }
  }, [transactions.length]);

  const balanceAlerts = useMemo(() => {
    const rawAlerts = calculateBalanceAlerts(accounts, transactions, recurring);
    // Filter out alerts that the user has dismissed
    return rawAlerts.filter(alert => !dismissedAlerts.includes(`${alert.accountId}-${alert.date}`));
  }, [accounts, transactions, recurring, dismissedAlerts]);

  const handleDismissAlert = (accountId: string, date: string) => {
    const alertId = `${accountId}-${date}`;
    const updated = [...dismissedAlerts, alertId];
    setDismissedAlerts(updated);
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(updated));
  };

  const displayCurrency = selectedAccountId 
     ? (accounts.find(a => a.id === selectedAccountId)?.currency || 'ILS')
     : (accounts[0]?.currency || 'ILS');

  const stats = useMemo(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    let currentIncome = 0;
    let currentExpense = 0;
    let lastIncome = 0;
    let lastExpense = 0;

    transactions.forEach(t => {
      const d = parseISO(t.date);
      const isTargetAcc = !selectedAccountId || t.accountId === selectedAccountId || t.toAccountId === selectedAccountId;
      if (!isTargetAcc) return;

      if (isWithinInterval(d, { start: currentMonthStart, end: currentMonthEnd })) {
        if (t.type === TransactionType.INCOME) currentIncome += t.amount;
        else if (t.type === TransactionType.EXPENSE) currentExpense += t.amount;
      } else if (isWithinInterval(d, { start: lastMonthStart, end: lastMonthEnd })) {
        if (t.type === TransactionType.INCOME) lastIncome += t.amount;
        else if (t.type === TransactionType.EXPENSE) lastExpense += t.amount;
      }
    });

    const incomeChange = lastIncome ? ((currentIncome - lastIncome) / lastIncome) * 100 : 0;
    const expenseChange = lastExpense ? ((currentExpense - lastExpense) / lastExpense) * 100 : 0;

    return {
      currentIncome,
      currentExpense,
      netCashFlow: currentIncome - currentExpense,
      incomeChange,
      expenseChange
    };
  }, [transactions, selectedAccountId]);

  const balances = useMemo(() => {
    const accBalances: Record<string, number> = {};
    accounts.forEach(a => accBalances[a.id] = a.initialBalance || 0);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    transactions.forEach(t => {
      if (t.date > todayStr) return;
      if (t.type === TransactionType.INCOME) accBalances[t.accountId] += t.amount;
      else if (t.type === TransactionType.EXPENSE) accBalances[t.accountId] -= t.amount;
      else if (t.type === TransactionType.TRANSFER && t.toAccountId) {
          accBalances[t.accountId] -= t.amount;
          if (accBalances[t.toAccountId] !== undefined) accBalances[t.toAccountId] += t.amount;
      }
    });
    return accBalances;
  }, [transactions, accounts]);

  const accountBarData = useMemo(() => {
    return sortAccounts(accounts)
      .filter(a => (a.type === 'checking' || a.type === 'credit' || a.type === 'cash') && (!selectedAccountId || a.id === selectedAccountId))
      .map(a => ({
          name: a.name,
          balance: balances[a.id] || 0,
          color: a.color
      }));
  }, [accounts, balances, selectedAccountId]);

  const balanceHistory = useMemo(() => {
    const isLiquid = (a: Account) => a.type === 'checking' || a.type === 'credit' || a.type === 'cash';
    const targetAccountIds = selectedAccountId
        ? [selectedAccountId]
        : accounts.filter(a => a.currency === displayCurrency && isLiquid(a)).map(a => a.id);
    
    if (targetAccountIds.length === 0) return [];
    
    const today = startOfDay(new Date());
    const currentBalances: Record<string, number> = {};
    targetAccountIds.forEach(id => currentBalances[id] = accounts.find(a => a.id === id)?.initialBalance || 0);

    transactions.filter(t => parseISO(t.date) <= today).forEach(t => {
        if (targetAccountIds.includes(t.accountId)) {
            if (t.type === TransactionType.INCOME) currentBalances[t.accountId] += t.amount;
            else currentBalances[t.accountId] -= t.amount;
        }
        if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) currentBalances[t.toAccountId] += t.amount;
    });

    const dataPoints: any[] = [];
    const getSum = (bals: Record<string, number>) => Object.values(bals).reduce((s, v) => s + v, 0);

    const tempBals = { ...currentBalances };
    dataPoints.push({ date: format(today, 'yyyy-MM-dd'), displayDate: 'Today', balance: getSum(tempBals), type: 'actual', ...tempBals });
    
    for (let i = 1; i <= 30; i++) {
        const d = subDays(today, i);
        const dStr = format(d, 'yyyy-MM-dd');
        transactions.filter(t => t.date === dStr).forEach(t => {
            if (targetAccountIds.includes(t.accountId)) {
                if (t.type === TransactionType.INCOME) tempBals[t.accountId] -= t.amount;
                else tempBals[t.accountId] += t.amount;
            }
            if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) tempBals[t.toAccountId] -= t.amount;
        });
        dataPoints.unshift({ date: format(subDays(d, 1), 'yyyy-MM-dd'), displayDate: format(d, 'MMM d'), balance: getSum(tempBals), type: 'actual', ...tempBals });
    }

    const forecastBals = { ...currentBalances };
    const activeRecs = recurring.filter(r => r.isActive).map(r => ({ ...r, next: parseISO(r.nextDueDate) }));
    for (let i = 1; i <= 60; i++) {
        const d = addDays(today, i);
        const dStr = format(d, 'yyyy-MM-dd');
        transactions.filter(t => t.date === dStr).forEach(t => {
          if (targetAccountIds.includes(t.accountId)) {
              if (t.type === TransactionType.INCOME) forecastBals[t.accountId] += t.amount;
              else forecastBals[t.accountId] -= t.amount;
          }
          if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) forecastBals[t.toAccountId] += t.amount;
        });

        activeRecs.forEach(r => {
            if (isSameDay(r.next, d)) {
                const amt = getSmartAmount(r, d, transactions);
                if (targetAccountIds.includes(r.accountId)) {
                    if (r.type === TransactionType.INCOME) forecastBals[r.accountId] += amt;
                    else forecastBals[r.accountId] -= amt;
                }
                if (r.toAccountId && targetAccountIds.includes(r.toAccountId)) forecastBals[r.toAccountId] += amt;
                r.next = calculateNextDate(r.next, r.frequency, r.customInterval, r.customUnit);
            }
        });
        dataPoints.push({ date: dStr, displayDate: format(d, 'MMM d'), forecast: getSum(forecastBals), type: 'forecast', ...forecastBals });
    }
    return dataPoints;
  }, [transactions, recurring, accounts, selectedAccountId, displayCurrency]);

  const tooltipStyle = { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '16px', zIndex: 1000 };

  return (
    <div className="space-y-8 animate-fade-in pb-12 max-w-7xl mx-auto">
      
      {/* Predictive Alerts Banner */}
      {balanceAlerts.length > 0 && (
        <div className="space-y-3">
          {balanceAlerts.map((alert, i) => (
            <div key={`${alert.accountId}-${alert.date}`} className={`p-4 rounded-2xl border flex items-center justify-between gap-4 shadow-sm animate-fade-in ${alert.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <div className="flex items-center gap-4 flex-1">
                <div className={`p-2 rounded-xl shrink-0 ${alert.severity === 'critical' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                   <AlertTriangle size={24}/>
                </div>
                <div>
                   <p className="font-black text-sm uppercase tracking-tight">Projected Liquidity Gap</p>
                   <p className="text-xs font-medium leading-relaxed">
                     Based on upcoming <strong>{alert.triggerPayee}</strong> ({formatCurrency(alert.triggerAmount)}) on {alert.date}, 
                     your <strong>{alert.accountName}</strong> balance will hit <span className="font-black">{formatCurrency(alert.projectedBalance)}</span>.
                   </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'forecast' }))}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all whitespace-nowrap ${alert.severity === 'critical' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
                >
                  Model Solutions <ArrowRight size={14}/>
                </button>
                <button 
                  onClick={() => handleDismissAlert(alert.accountId, alert.date)}
                  className={`p-2 rounded-xl transition-all ${alert.severity === 'critical' ? 'hover:bg-red-200 text-red-400' : 'hover:bg-amber-200 text-amber-400'}`}
                  title="Dismiss alert"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flash Insights Marquee */}
      {(anomalies.length > 0 || isAnalyzing) && (
        <div className="bg-brand-900 text-white p-3 rounded-2xl flex items-center gap-4 overflow-hidden border border-brand-700 shadow-xl">
           <div className="flex items-center gap-2 px-3 border-r border-brand-700 whitespace-nowrap shrink-0">
             <Sparkles size={16} className="text-brand-400 animate-pulse" />
             <span className="text-[10px] font-black uppercase tracking-widest">Flash Insights</span>
           </div>
           <div className="flex-1 overflow-hidden">
              {isAnalyzing ? (
                <span className="text-xs font-medium animate-pulse">המערכת מנתחת תנועות חריגות...</span>
              ) : (
                <div className="flex gap-8 animate-marquee whitespace-nowrap">
                  {anomalies.map((a, i) => (
                    <span key={i} className="text-xs font-bold flex items-center gap-2">
                       <AlertCircle size={14} className="text-orange-400"/> {a}
                    </span>
                  ))}
                  {anomalies.map((a, i) => (
                    <span key={`dup-${i}`} className="text-xs font-bold flex items-center gap-2">
                       <AlertCircle size={14} className="text-orange-400"/> {a}
                    </span>
                  ))}
                </div>
              )}
           </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><TrendingUp size={24}/></div>
            <div className={`flex items-center gap-1 text-xs font-black ${stats.incomeChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {Math.abs(stats.incomeChange).toFixed(1)}%
            </div>
          </div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Monthly Income</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(stats.currentIncome, displayCurrency)}</h3>
        </div>

        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-red-50 text-red-600 rounded-2xl"><TrendingDown size={24}/></div>
            <div className={`flex items-center gap-1 text-xs font-black ${stats.expenseChange <= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {Math.abs(stats.expenseChange).toFixed(1)}%
            </div>
          </div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Monthly Expenses</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(stats.currentExpense, displayCurrency)}</h3>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Zap size={24}/></div>
            <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest bg-brand-500/10 px-2 py-1 rounded-lg">Live Flow</div>
          </div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Cash Flow</p>
          <h3 className="text-2xl font-black">{formatCurrency(stats.netCashFlow, displayCurrency)}</h3>
        </div>
      </div>

      {/* Liquidity Trend */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-8">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Activity size={22} className="text-brand-500"/>Liquidity Trend</h3>
            {!selectedAccountId && (
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1"><Info size={10}/> Consolidated Liquidity View</p>
            )}
          </div>
          <button onClick={() => setShowIndividualLines(!showIndividualLines)} className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl border transition-all ${showIndividualLines ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
            {showIndividualLines ? 'Hide Account Details' : 'Show Account Details'}
          </button>
        </div>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={balanceHistory}>
              <defs>
                <linearGradient id="colorNet" x1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="displayDate" tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 700}} axisLine={false} tickLine={false} interval={7} />
              <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${v/1000}k` : v} />
              <Tooltip 
                contentStyle={tooltipStyle} 
                formatter={(v: number, name: string) => [formatCurrency(v, displayCurrency), name]} 
              />
              <ReferenceLine x="Today" stroke="#94a3b8" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="balance" stroke="#0ea5e9" strokeWidth={4} fill="url(#colorNet)" name="Actual Net" />
              <Area type="monotone" dataKey="forecast" stroke="#8b5cf6" strokeWidth={4} strokeDasharray="6 4" fill="transparent" name="Forecast Net" />
              {showIndividualLines && accounts.filter(a => a.currency === displayCurrency && (a.type==='checking'||a.type==='credit'||a.type==='cash')).map(acc => (
                <Area key={acc.id} type="monotone" dataKey={acc.id} stroke={acc.color} strokeWidth={1.5} fill="transparent" name={acc.name} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Grid: Account Balances (Wider) & Savings Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-2"><Wallet size={20} className="text-brand-500"/>Account Balances</h3>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={accountBarData} layout="vertical" margin={{ left: 20, right: 60 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#475569' }} width={100} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(v: number) => [formatCurrency(v, displayCurrency), 'Balance']} />
                    <Bar dataKey="balance" radius={[0, 10, 10, 0]} barSize={28}>
                      {accountBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                      <LabelList dataKey="balance" position="right" formatter={(v: number) => formatCurrency(v, displayCurrency)} style={{ fontSize: '11px', fontWeight: 'bold', fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
          </div>

          <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Target size={20} className="text-orange-500"/>Active Savings Goals</h3>
              </div>
              <div className="space-y-6 overflow-y-auto max-h-[350px] pr-2 custom-scrollbar">
                  {goals.filter(g => g.isActive).length > 0 ? goals.filter(g => g.isActive).map(goal => {
                    const percent = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
                    return (
                      <div key={goal.id} className="space-y-2">
                        <div className="flex justify-between items-end">
                           <div>
                             <p className="text-xs font-black text-slate-800">{goal.name}</p>
                             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{goal.deadline ? `Target: ${goal.deadline}` : 'Long-term'}</p>
                           </div>
                           <p className="text-[10px] font-black text-slate-700">{formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}</p>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                           <div className="h-full transition-all duration-1000 rounded-full" style={{ width: `${percent}%`, backgroundColor: goal.color }} />
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                      <Target size={48} className="opacity-20 mb-2" />
                      <p className="text-xs font-black uppercase tracking-widest">No Active Goals</p>
                    </div>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
}
