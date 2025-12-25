
import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Cell, ReferenceLine, LabelList, AreaChart, Area
} from 'recharts';
import { Transaction, TransactionType, Account, RecurringTransaction, SmartCategoryBudget, FinancialGoal, BalanceAlert } from '../types';
import { TrendingUp, TrendingDown, Activity, Wallet, Zap, Info, AlertCircle, Target, Sparkles, AlertTriangle, ArrowRight, X, Database, Server, RefreshCw, LayoutGrid, Layers, BarChart3, Search } from 'lucide-react';
import { formatCurrency } from '../utils/currency';
import { addDays, format, parseISO, startOfDay, subDays, isSameDay, startOfMonth, endOfMonth, isWithinInterval, subMonths } from 'date-fns';
import { calculateNextDate, getSmartAmount, sortAccounts, calculateBalanceAlerts } from '../utils/finance';
import { analyzeAnomalies, hasValidApiKey } from '../services/geminiService';
import { checkTableHealth } from '../services/storageService';

const DISMISSED_ALERTS_KEY = 'financeflow_dismissed_alerts';
const AI_ANOMALIES_CACHE_KEY = 'financeflow_ai_anomalies';

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
  const [anomalies, setAnomalies] = useState<string[]>(() => {
    const cached = localStorage.getItem(AI_ANOMALIES_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAiMissing, setIsAiMissing] = useState(!hasValidApiKey());
  const [dbUnhealthy, setDbUnhealthy] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(() => {
    try {
      const stored = sessionStorage.getItem(DISMISSED_ALERTS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) { return []; }
  });

  const checkHealth = async () => {
    setIsCheckingHealth(true);
    const health = await checkTableHealth();
    setDbUnhealthy(Object.values(health).some(v => v === false));
    setIsCheckingHealth(false);
  };

  useEffect(() => {
    checkHealth();
    setIsAiMissing(!hasValidApiKey());
  }, []);

  const handleRunAiScan = async () => {
    if (isAnalyzing || isAiMissing) return;
    setIsAnalyzing(true);
    try {
      const res = await analyzeAnomalies(transactions);
      setAnomalies(res);
      localStorage.setItem(AI_ANOMALIES_CACHE_KEY, JSON.stringify(res));
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const balanceAlerts = useMemo(() => {
    const rawAlerts = calculateBalanceAlerts(accounts, transactions, recurring);
    return rawAlerts.filter(alert => !dismissedAlerts.includes(`${alert.accountId}-${alert.date}`));
  }, [accounts, transactions, recurring, dismissedAlerts]);

  const handleDismissAlert = (accountId: string, date: string) => {
    const alertId = `${accountId}-${date}`;
    const updated = [...dismissedAlerts, alertId];
    setDismissedAlerts(updated);
    sessionStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(updated));
  };

  const displayCurrency = selectedAccountId 
     ? (accounts.find(a => a.id === selectedAccountId)?.currency || 'ILS')
     : (accounts[0]?.currency || 'ILS');

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
    const netWorth = Object.values(balances).reduce((sum: number, b: number) => sum + b, 0);

    return { currentIncome, currentExpense, netCashFlow: currentIncome - currentExpense, incomeChange, expenseChange, netWorth };
  }, [transactions, selectedAccountId, balances]);

  const liquidAccountBarData = useMemo(() => {
    const liquidTypes = ['checking', 'credit', 'cash'];
    return sortAccounts(accounts)
      .filter(a => liquidTypes.includes(a.type))
      .filter(a => (!selectedAccountId || a.id === selectedAccountId))
      .map(a => ({ name: a.name, balance: balances[a.id] || 0, color: a.color }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [accounts, balances, selectedAccountId]);

  const balanceHistory = useMemo(() => {
    const isLiquid = (a: Account) => a.type === 'checking' || a.type === 'credit' || a.type === 'cash';
    const targetAccountIds = selectedAccountId ? [selectedAccountId] : accounts.filter(a => a.currency === displayCurrency && isLiquid(a)).map(a => a.id);
    if (targetAccountIds.length === 0) return [];
    
    const today = startOfDay(new Date());
    const currentBalancesAtHistory: Record<string, number> = {};
    targetAccountIds.forEach(id => currentBalancesAtHistory[id] = accounts.find(a => a.id === id)?.initialBalance || 0);

    transactions.filter(t => parseISO(t.date) <= today).forEach(t => {
        if (targetAccountIds.includes(t.accountId)) {
            if (t.type === TransactionType.INCOME) currentBalancesAtHistory[t.accountId] += t.amount;
            else currentBalancesAtHistory[t.accountId] -= t.amount;
        }
        if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) currentBalancesAtHistory[t.toAccountId] += t.amount;
    });

    const dataPoints: any[] = [];
    const getSum = (bals: Record<string, number>) => Object.values(bals).reduce((s, v) => s + v, 0);
    const tempBals = { ...currentBalancesAtHistory };
    dataPoints.push({ date: format(today, 'yyyy-MM-dd'), displayDate: 'Today', balance: getSum(tempBals), type: 'actual', ...tempBals });
    
    for (let i = 1; i <= 30; i++) {
        const d = subDays(today, i);
        const dStr = format(d, 'yyyy-MM-dd');
        transactions.filter(t => t.date === dStr).forEach(t => {
            if (targetAccountIds.includes(t.accountId)) { if (t.type === TransactionType.INCOME) tempBals[t.accountId] -= t.amount; else tempBals[t.accountId] += t.amount; }
            if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) tempBals[t.toAccountId] -= t.amount;
        });
        dataPoints.unshift({ date: dStr, displayDate: format(d, 'MMM d'), balance: getSum(tempBals), type: 'actual', ...tempBals });
    }

    const forecastBals = { ...currentBalancesAtHistory };
    const activeRecs = recurring.filter(r => r.isActive).map(r => ({ ...r, next: parseISO(r.nextDueDate) }));
    for (let i = 1; i <= 60; i++) {
        const d = addDays(today, i);
        const dStr = format(d, 'yyyy-MM-dd');
        transactions.filter(t => t.date === dStr).forEach(t => {
          if (targetAccountIds.includes(t.accountId)) { if (t.type === TransactionType.INCOME) forecastBals[t.accountId] += t.amount; else forecastBals[t.accountId] -= t.amount; }
          if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) forecastBals[t.toAccountId] += t.amount;
        });
        activeRecs.forEach(r => {
            if (isSameDay(r.next, d)) {
                const amt = getSmartAmount(r, d, transactions);
                if (targetAccountIds.includes(r.accountId)) { if (r.type === TransactionType.INCOME) forecastBals[r.accountId] += amt; else forecastBals[r.accountId] -= amt; }
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
      
      {/* 0. NOTIFICATIONS & HEALTH */}
      {dbUnhealthy && (
        <div className="bg-red-600 text-white p-6 rounded-[2rem] shadow-2xl border-4 border-red-500/50 animate-fade-in relative overflow-hidden mb-6">
            <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12"><Database size={120}/></div>
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                    <div className="p-4 bg-white/20 rounded-2xl animate-pulse"><Server size={40}/></div>
                    <div>
                        <h2 className="text-2xl font-black tracking-tight uppercase">Database Schema Error</h2>
                        <p className="text-red-100 font-medium max-w-xl mt-1 leading-relaxed">
                            Your Supabase project hasn't been fully initialized with the required tables.
                        </p>
                    </div>
                </div>
                <button 
                    onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings:db' }))} 
                    className="bg-white text-red-600 px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl hover:bg-red-50 transition-all flex items-center gap-2"
                >
                    Repair Settings <ArrowRight size={18}/>
                </button>
            </div>
        </div>
      )}

      {balanceAlerts.length > 0 && !dbUnhealthy && (
        <div className="space-y-3 mb-6">
          {balanceAlerts.map((alert) => (
            <div key={`${alert.accountId}-${alert.date}`} className={`p-4 rounded-2xl border flex items-center justify-between gap-4 shadow-sm animate-fade-in ${alert.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <div className="flex items-center gap-4 flex-1">
                <div className={`p-2 rounded-xl shrink-0 ${alert.severity === 'critical' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                   <AlertTriangle size={24}/>
                </div>
                <div>
                   <p className="font-black text-sm uppercase tracking-tight">Liquidity Gap Alert</p>
                   <p className="text-xs font-medium">Your <strong>{alert.accountName}</strong> will hit <span className="font-black">{formatCurrency(alert.projectedBalance)}</span> on {alert.date}.</p>
                </div>
              </div>
              <button onClick={() => handleDismissAlert(alert.accountId, alert.date)} className="p-2 hover:bg-black/5 rounded-xl"><X size={18} /></button>
            </div>
          ))}
        </div>
      )}

      {/* 1. SUMMARY CARDS (QUICKEN STYLE - TOP PRIORITY) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><TrendingUp size={24}/></div>
            <div className={`flex items-center gap-1 text-xs font-black ${stats.incomeChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{Math.abs(stats.incomeChange).toFixed(1)}%</div>
          </div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Income (Month)</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(stats.currentIncome, displayCurrency)}</h3>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-red-50 text-red-600 rounded-2xl"><TrendingDown size={24}/></div>
            <div className={`flex items-center gap-1 text-xs font-black ${stats.expenseChange <= 0 ? 'text-green-600' : 'text-red-600'}`}>{Math.abs(stats.expenseChange).toFixed(1)}%</div>
          </div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Expense (Month)</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(stats.currentExpense, displayCurrency)}</h3>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl"><Layers size={24}/></div>
            <div className="text-[10px] font-black text-brand-600 uppercase tracking-widest bg-brand-50 px-2 py-1 rounded-lg">Net Worth</div>
          </div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Global Assets</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(stats.netWorth, displayCurrency)}</h3>
        </div>
        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl"><Zap size={24}/></div>
            <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest bg-brand-500/10 px-2 py-1 rounded-lg">Flow</div>
          </div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Cash Flow</p>
          <h3 className="text-2xl font-black">{formatCurrency(stats.netCashFlow, displayCurrency)}</h3>
        </div>
      </div>

      {/* 2. FLASH INSIGHTS (AI SCAN BAR) */}
      <div className="bg-brand-900 text-white p-4 rounded-2xl flex items-center gap-4 overflow-hidden border border-brand-700 shadow-xl">
           <div className="flex items-center gap-2 px-3 border-r border-brand-700 whitespace-nowrap shrink-0">
             <Sparkles size={16} className="text-brand-400" />
             <span className="text-[10px] font-black uppercase tracking-widest">AI Agent</span>
           </div>
           <div className="flex-1 overflow-hidden">
              {isAiMissing ? (
                <span className="text-xs font-medium text-brand-300">AI analysis disabled. Connect Gemini key in Settings.</span>
              ) : isAnalyzing ? (
                <span className="text-xs font-medium animate-pulse">Running Deep Scan...</span>
              ) : anomalies.length === 0 ? (
                <span className="text-xs font-medium text-brand-300">Scan your data for price hikes or unusual activity.</span>
              ) : (
                <div className="flex gap-8 animate-marquee whitespace-nowrap">
                  {anomalies.map((a, i) => (
                    <span key={i} className="text-xs font-bold flex items-center gap-2">
                       <AlertCircle size={14} className="text-orange-400"/> {a}
                    </span>
                  ))}
                </div>
              )}
           </div>
           {!isAiMissing && (
             <button 
              onClick={handleRunAiScan} 
              disabled={isAnalyzing}
              className="bg-brand-600 hover:bg-brand-500 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center gap-2 transition-all disabled:opacity-50"
             >
                {isAnalyzing ? <RefreshCw size={12} className="animate-spin"/> : <Search size={12}/>}
                {anomalies.length > 0 ? 'Rescan' : 'Run AI Scan'}
             </button>
           )}
      </div>

      {/* 3. LIQUIDITY TREND CHART (FORECAST & HISTORY - RESTORED TO PRIMARY POSITION) */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 animate-fade-in">
        <div className="flex justify-between items-center mb-8">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Activity size={22} className="text-brand-500"/>Liquidity Trend</h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1"><Info size={10}/> Consolidated View (Past 30d / Future 60d)</p>
          </div>
          <button onClick={() => setShowIndividualLines(!showIndividualLines)} className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl border transition-all ${showIndividualLines ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
            {showIndividualLines ? 'Hide Account Details' : 'Show Account Details'}
          </button>
        </div>
        <div className="h-[400px]">
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
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [formatCurrency(v, displayCurrency), name]} />
              <ReferenceLine x="Today" stroke="#94a3b8" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="balance" stroke="#0ea5e9" strokeWidth={4} fill="url(#colorNet)" name="Actual Net" isAnimationActive={false} />
              <Area type="monotone" dataKey="forecast" stroke="#8b5cf6" strokeWidth={4} strokeDasharray="6 4" fill="transparent" name="Forecast Net" isAnimationActive={false} />
              {showIndividualLines && accounts.filter(a => a.currency === displayCurrency && (a.type==='checking'||a.type==='credit'||a.type==='cash')).map(acc => (
                <Area key={acc.id} type="monotone" dataKey={acc.id} stroke={acc.color} strokeWidth={1.5} fill="transparent" name={acc.name} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4. LIQUID ASSETS DISTRIBUTION (ACCOUNT SNAPSHOT) */}
      <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col min-h-[450px]">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl"><Wallet size={20}/></div>
          <div>
            <h3 className="text-xl font-bold text-gray-800">Liquid Assets Overview</h3>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Checking, Credit & Cash Distribution</p>
          </div>
        </div>
        
        {liquidAccountBarData.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-100 rounded-3xl">
            <BarChart3 size={48} className="text-slate-200 mb-4"/>
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No Liquid Accounts Defined</p>
          </div>
        ) : (
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={liquidAccountBarData} layout="vertical" margin={{ left: 20, right: 40, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" tick={{fontSize: 10, fontWeight: 700, fill: '#64748b'}} axisLine={false} tickLine={false} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v, displayCurrency), 'Balance']} cursor={{fill: '#f8fafc'}} />
                <Bar dataKey="balance" radius={[0, 10, 10, 0]} barSize={24}>
                  {liquidAccountBarData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                  <LabelList dataKey="balance" position="right" formatter={(v: number) => formatCurrency(v, displayCurrency)} style={{fontSize: '9px', fontWeight: '900', fill: '#475569'}} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

    </div>
  );
}
