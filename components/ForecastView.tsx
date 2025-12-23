
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, ComposedChart, BarChart, Bar, LabelList } from 'recharts';
import { Transaction, RecurringTransaction, TransactionType, Account, SmartCategoryBudget, Frequency } from '../types';
import { generateFinancialInsight, createFinancialChatSession } from '../services/geminiService';
import { Sparkles, Activity, MessageSquare, Send, Bot, User, Plus, Trash2, Sliders, PlayCircle, Settings2, Repeat, Target, Info, Calendar, Loader, CreditCard } from 'lucide-react';
import { addDays, format, parseISO, startOfDay, isSameDay, startOfMonth, endOfMonth, differenceInDays, addMonths, isBefore, addWeeks, addYears } from 'date-fns';
import { formatCurrency } from '../utils/currency';
import { calculateNextDate, getSmartAmount, getEffectiveCategoryBudget } from '../utils/finance';
import { Chat } from "@google/genai";

interface ForecastViewProps {
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  categoryBudgets: SmartCategoryBudget[];
  accounts: Account[];
  selectedAccountId: string | null;
  insight: string | null;
  setInsight: (insight: string | null) => void;
  viewMode?: 'forecast' | 'ai';
  persistentChatMessages?: { role: 'user' | 'model'; text: string }[];
  onUpdateChatMessages?: (msgs: { role: 'user' | 'model'; text: string }[]) => void;
  chatSessionRef?: React.MutableRefObject<Chat | null>;
}

type ForecastPeriod = '2m' | '3m' | '6m' | '1y';
type ChatMessage = { role: 'user' | 'model'; text: string };

interface TentativeTx {
    id: string;
    date: string;
    amount: number;
    payee: string;
    type: TransactionType;
}

interface Scenario {
    id: string;
    name: string;
    color: string;
    isActive: boolean;
    expenseReduction: number;
    oneTimeIncome: number;
    tentativeTxs: TentativeTx[];
    recurringOverrides: Record<string, number>;
}

const SCENARIO_COLORS = ['#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316'];
const CHART_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#3b82f6', '#14b8a6', '#6366f1', '#a855f7'];

export const ForecastView: React.FC<ForecastViewProps> = ({ 
    transactions, 
    recurring, 
    categoryBudgets,
    accounts, 
    selectedAccountId, 
    insight, 
    setInsight, 
    viewMode = 'forecast',
    persistentChatMessages = [],
    onUpdateChatMessages,
    chatSessionRef
}) => {
  const [activeAiTab, setActiveAiTab] = useState<'insight' | 'chat'>('insight');
  const [period, setPeriod] = useState<ForecastPeriod>('6m');
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [showScenariosPanel, setShowScenariosPanel] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([
      { id: 's1', name: 'Scenario A', color: SCENARIO_COLORS[0], isActive: true, expenseReduction: 0, oneTimeIncome: 0, tentativeTxs: [], recurringOverrides: {} }
  ]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>('s1');

  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Form states for tentative transactions
  const [newTentativeDate, setNewTentativeDate] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [newTentativeAmount, setNewTentativeAmount] = useState('');
  const [newTentativePayee, setNewTentativePayee] = useState('');
  const [newTentativeType, setNewTentativeType] = useState<TransactionType>(TransactionType.EXPENSE);

  const activeScenario = scenarios.find(s => s.id === activeScenarioId) || scenarios[0];

  const targetAccountIds = useMemo(() => {
    if (selectedAccountId) return [selectedAccountId];
    return accounts.filter(a => a.type === 'checking' || a.type === 'credit' || a.type === 'cash').map(a => a.id);
  }, [accounts, selectedAccountId]);

  const checkingAccountIds = useMemo(() => accounts.filter(a => a.type === 'checking').map(a => a.id), [accounts]);

  const initialBalances = useMemo(() => {
    const today = startOfDay(new Date());
    let net = accounts.filter(a => targetAccountIds.includes(a.id)).reduce((acc, a) => acc + a.initialBalance, 0);
    let check = accounts.filter(a => checkingAccountIds.includes(a.id)).reduce((acc, a) => acc + a.initialBalance, 0);
    transactions.forEach(t => {
         if (parseISO(t.date) <= today) {
            if (targetAccountIds.includes(t.accountId)) {
                if (t.type === TransactionType.INCOME) net += t.amount;
                else net -= t.amount;
            }
            if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) net += t.amount;
            if (checkingAccountIds.includes(t.accountId)) {
                if (t.type === TransactionType.INCOME) check += t.amount;
                else check -= t.amount;
            }
            if (t.toAccountId && checkingAccountIds.includes(t.toAccountId)) check += t.amount;
         }
    });
    return { net, check };
  }, [transactions, accounts, targetAccountIds, checkingAccountIds]);

  const displayCurrency = selectedAccountId ? accounts.find(a => a.id === selectedAccountId)?.currency || 'ILS' : 'ILS';

  // Fallback for payee content
  const getPayeeName = (r: any) => r.payee || r.description || 'Unknown Item';

  // Aggregating installment payees into a unique set
  const installmentPayees = useMemo(() => {
    const payees = new Set<string>();
    recurring.forEach(r => {
      if (r.isActive && r.type === TransactionType.EXPENSE && r.totalOccurrences !== undefined && r.totalOccurrences > 0) {
        const name = getPayeeName(r);
        if (name) payees.add(name);
      }
    });
    return Array.from(payees).sort();
  }, [recurring]);

  const installmentsSummary = useMemo(() => {
    const activeInstallments = recurring.filter(r => r.isActive && r.type === TransactionType.EXPENSE && r.totalOccurrences !== undefined && r.totalOccurrences > 0);
    const today = startOfDay(new Date());
    const horizonDate = addMonths(today, 24);
    
    const roadmap: any[] = [];
    for (let i = 0; i < 24; i++) {
        const targetMonth = startOfMonth(addMonths(today, i));
        roadmap.push({ name: format(targetMonth, 'MMM yy'), total: 0, _rawDate: targetMonth });
    }

    activeInstallments.forEach(r => {
        let currentSimDate = parseISO(r.nextDueDate);
        let count = r.occurrencesProcessed || 0;
        const total = r.totalOccurrences || 0;
        const name = getPayeeName(r);
        
        while (isBefore(currentSimDate, horizonDate) && count < total) {
            if (!isBefore(currentSimDate, today)) {
                const monthLabel = format(startOfMonth(currentSimDate), 'MMM yy');
                const point = roadmap.find(p => p.name === monthLabel);
                if (point) {
                    point[name] = (point[name] || 0) + r.amount;
                    point.total += r.amount;
                }
            }
            currentSimDate = calculateNextDate(currentSimDate, r.frequency, r.customInterval, r.customUnit);
            count++;
        }
    });

    const totalLeft = activeInstallments.reduce((sum, r) => {
        const remaining = (r.totalOccurrences || 0) - (r.occurrencesProcessed || 0);
        return sum + (Math.max(0, remaining) * r.amount);
    }, 0);

    return { totalLeft, roadmap: roadmap.filter(p => p.total > 0), activePayees: installmentPayees };
  }, [recurring, installmentPayees]);

  const forecastData = useMemo(() => {
    const points: any[] = [];
    const today = startOfDay(new Date());
    const horizonDays = period === '2m' ? 60 : period === '3m' ? 90 : period === '1y' ? 365 : 180;
    
    const scenarioBalances: Record<string, number> = {};
    const scenarioCheckingBalances: Record<string, number> = {};
    
    scenarios.forEach(s => { 
        scenarioBalances[s.id] = initialBalances.net + s.oneTimeIncome; 
        scenarioCheckingBalances[s.id] = initialBalances.check + s.oneTimeIncome;
    });

    let runningBalance = initialBalances.net;
    let runningChecking = initialBalances.check;

    const baselineRec = recurring.filter(r => r.isActive).map(r => ({ ...r, simDate: parseISO(r.nextDueDate) }));
    const scenarioRecs: Record<string, any[]> = {};
    scenarios.forEach(s => { 
        scenarioRecs[s.id] = recurring.filter(r => r.isActive).map(r => ({ ...r, simDate: parseISO(r.nextDueDate) })); 
    });
    
    for (let i = 0; i <= horizonDays; i++) {
      const currentDate = addDays(today, i);
      const currentDateStr = format(currentDate, 'yyyy-MM-dd');
      
      transactions.filter(t => t.date === currentDateStr).forEach(t => {
          if (targetAccountIds.includes(t.accountId)) {
              if (t.type === TransactionType.INCOME) runningBalance += t.amount;
              else runningBalance -= t.amount;
          }
          if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) runningBalance += t.amount;
          
          if (checkingAccountIds.includes(t.accountId)) {
              if (t.type === TransactionType.INCOME) runningChecking += t.amount;
              else runningChecking -= t.amount;
          }
          if (t.toAccountId && checkingAccountIds.includes(t.toAccountId)) runningChecking += t.amount;
      });

      baselineRec.forEach(r => {
        if (isSameDay(r.simDate, currentDate)) {
           const amount = getSmartAmount(r, currentDate, transactions);
           if (targetAccountIds.includes(r.accountId)) { if (r.type === TransactionType.INCOME) runningBalance += amount; else runningBalance -= amount; }
           if (r.toAccountId && targetAccountIds.includes(r.toAccountId)) runningBalance += amount;
           if (checkingAccountIds.includes(r.accountId)) { if (r.type === TransactionType.INCOME) runningChecking += amount; else runningChecking -= amount; }
           if (r.toAccountId && checkingAccountIds.includes(r.toAccountId)) runningChecking += amount;
           r.simDate = calculateNextDate(r.simDate, r.frequency, r.customInterval, r.customUnit);
        }
      });

      scenarios.forEach(s => {
          if (!s.isActive) return;
          
          transactions.filter(t => t.date === currentDateStr).forEach(t => {
              if (targetAccountIds.includes(t.accountId)) {
                  const reduction = (t.type === TransactionType.EXPENSE) ? (1 - s.expenseReduction / 100) : 1;
                  if (t.type === TransactionType.INCOME) scenarioBalances[s.id] += t.amount;
                  else scenarioBalances[s.id] -= t.amount * reduction;
              }
              if (t.toAccountId && targetAccountIds.includes(t.toAccountId)) scenarioBalances[s.id] += t.amount;

              if (checkingAccountIds.includes(t.accountId)) {
                  const reduction = (t.type === TransactionType.EXPENSE) ? (1 - s.expenseReduction / 100) : 1;
                  if (t.type === TransactionType.INCOME) scenarioCheckingBalances[s.id] += t.amount;
                  else scenarioCheckingBalances[s.id] -= t.amount * reduction;
              }
              if (t.toAccountId && checkingAccountIds.includes(t.toAccountId)) scenarioCheckingBalances[s.id] += t.amount;
          });

          scenarioRecs[s.id].forEach(r => {
              if (isSameDay(r.simDate, currentDate)) {
                  const baseAmt = getSmartAmount(r, currentDate, transactions);
                  const scenarioAmt = s.recurringOverrides[r.id] !== undefined ? s.recurringOverrides[r.id] : baseAmt;
                  const reduction = (r.type === TransactionType.EXPENSE) ? (1 - s.expenseReduction / 100) : 1;

                  if (targetAccountIds.includes(r.accountId)) { 
                      if (r.type === TransactionType.INCOME) scenarioBalances[s.id] += scenarioAmt; 
                      else scenarioBalances[s.id] -= scenarioAmt * reduction; 
                  }
                  if (r.toAccountId && targetAccountIds.includes(r.toAccountId)) scenarioBalances[s.id] += scenarioAmt;

                  if (checkingAccountIds.includes(r.accountId)) {
                      if (r.type === TransactionType.INCOME) scenarioCheckingBalances[s.id] += scenarioAmt; 
                      else scenarioCheckingBalances[s.id] -= scenarioAmt * reduction; 
                  }
                  if (r.toAccountId && checkingAccountIds.includes(r.toAccountId)) scenarioCheckingBalances[s.id] += scenarioAmt;

                  r.simDate = calculateNextDate(r.simDate, r.frequency, r.customInterval, r.customUnit);
              }
          });
          
          s.tentativeTxs.forEach(t => { 
              if (t.date === currentDateStr) { 
                  if (t.type === TransactionType.INCOME) {
                      scenarioBalances[s.id] += t.amount; 
                      scenarioCheckingBalances[s.id] += t.amount;
                  } else {
                      scenarioBalances[s.id] -= t.amount; 
                      scenarioCheckingBalances[s.id] -= t.amount;
                  } 
              } 
          });
      });
      
      const point: any = { 
          date: currentDateStr, 
          displayDate: format(currentDate, 'MMM d'), 
          balance: runningBalance, 
          checkingBalance: runningChecking 
      };
      
      scenarios.forEach(s => {
          if (s.isActive) {
              point[`net_${s.id}`] = scenarioBalances[s.id];
              point[`check_${s.id}`] = scenarioCheckingBalances[s.id];
          }
      });
      
      points.push(point);
    }
    return points;
  }, [recurring, transactions, initialBalances, period, targetAccountIds, checkingAccountIds, scenarios]);

  const tooltipStyle = { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '16px', zIndex: 1000 };
  const tooltipItemStyle = { fontSize: '13px', fontWeight: 700 };
  const tooltipLabelStyle = { color: '#64748b', fontSize: '11px', fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase' };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    
    const newMessages: ChatMessage[] = [...persistentChatMessages, { role: 'user', text: userMsg }];
    if (onUpdateChatMessages) onUpdateChatMessages(newMessages);
    
    setIsChatLoading(true);
    try {
      if (!chatSessionRef?.current) {
          if (chatSessionRef) chatSessionRef.current = createFinancialChatSession(transactions, recurring, accounts);
      }
      const result = await chatSessionRef?.current?.sendMessage({ message: userMsg });
      const finalMessages: ChatMessage[] = [...newMessages, { role: 'model', text: result?.text || 'No response.' }];
      if (onUpdateChatMessages) onUpdateChatMessages(finalMessages);
    } catch (e) {
      if (onUpdateChatMessages) onUpdateChatMessages([...newMessages, { role: 'model', text: 'Error interacting with AI.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [persistentChatMessages]);

  const updateScenario = (id: string, updates: Partial<Scenario>) => setScenarios(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  const addScenario = () => {
      const newS: Scenario = { id: crypto.randomUUID(), name: `Scenario ${scenarios.length + 1}`, color: SCENARIO_COLORS[scenarios.length % SCENARIO_COLORS.length], isActive: true, expenseReduction: 0, oneTimeIncome: 0, tentativeTxs: [], recurringOverrides: {} };
      setScenarios([...scenarios, newS]); setActiveScenarioId(newS.id);
  };

  const handleAddTentative = () => {
    if (!newTentativeAmount || !newTentativePayee) return;
    const newTx: TentativeTx = { id: crypto.randomUUID(), date: newTentativeDate, amount: parseFloat(newTentativeAmount), payee: newTentativePayee, type: newTentativeType };
    updateScenario(activeScenarioId, { tentativeTxs: [...activeScenario.tentativeTxs, newTx] });
    setNewTentativeAmount(''); setNewTentativePayee('');
  };

  if (viewMode === 'ai') {
    return (
      <div className="flex flex-col h-full space-y-6 animate-fade-in pb-10">
        <div className="flex bg-white p-2 rounded-2xl shadow-sm border border-slate-100 self-start">
            <button onClick={() => setActiveAiTab('insight')} className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${activeAiTab === 'insight' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}><Sparkles size={18}/> Insights</button>
            <button onClick={() => setActiveAiTab('chat')} className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${activeAiTab === 'chat' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}><MessageSquare size={18}/> Advisor Chat</button>
        </div>
        <div className="flex-1 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
            {activeAiTab === 'insight' ? (
                <div className="p-10 flex-1 overflow-auto text-right" dir="rtl">
                    <div className="flex items-center gap-6 mb-10">
                        <div className="p-4 bg-orange-50 text-orange-600 rounded-3xl"><Activity size={32}/></div>
                        <div><h2 className="text-2xl font-black text-slate-800">Smart Financial Analysis</h2></div>
                    </div>
                    {isLoadingInsight ? <div className="flex flex-col items-center justify-center py-20 gap-4"><Loader size={48} className="animate-spin text-orange-600"/></div> : insight ? <div className="whitespace-pre-wrap leading-relaxed text-slate-700 bg-slate-50 p-6 rounded-2xl">{insight}</div> : <button onClick={() => { setInsight(null); setIsLoadingInsight(true); generateFinancialInsight(transactions, forecastData).then(res => { setInsight(res); setIsLoadingInsight(false); }); }} className="bg-orange-600 text-white px-8 py-4 rounded-2xl font-black shadow-xl mx-auto">Generate Insight</button>}
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
                    <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={chatContainerRef}>
                        {persistentChatMessages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                                <Bot size={48} className="opacity-20"/>
                                <p className="text-sm font-medium">Ask me anything about your finances.</p>
                            </div>
                        )}
                        {persistentChatMessages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] p-4 rounded-2xl shadow-sm text-sm font-medium ${msg.role === 'user' ? 'bg-orange-600 text-white' : 'bg-white text-slate-700'}`}>
                                    <div className="whitespace-pre-wrap text-right" dir="rtl">{msg.text}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <form onSubmit={handleSendMessage} className="p-6 bg-white border-t flex gap-3"><input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask a financial question..." className="flex-1 p-4 bg-slate-50 border rounded-2xl text-right" dir="rtl" /><button type="submit" disabled={isChatLoading} className="bg-orange-600 text-white p-4 rounded-2xl shadow-lg"><Send size={20}/></button></form>
                </div>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full flex flex-col -m-8 relative animate-fade-in bg-slate-50 overflow-y-auto">
        <div className="p-8 flex flex-col gap-8">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-xl text-white flex items-center gap-6">
                    <div className="p-4 bg-slate-800 text-brand-400 rounded-2xl shadow-inner"><CreditCard size={32}/></div>
                    <div>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Total Installment Liability</p>
                        <h3 className="text-3xl font-black tracking-tighter">{formatCurrency(installmentsSummary.totalLeft, displayCurrency)}</h3>
                        <p className="text-xs text-slate-500 font-bold">Sum of all future fixed payments</p>
                    </div>
                </div>
             </div>

             <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                   <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Financial Forecast Engine</h2><p className="text-slate-500 font-medium text-sm">Projecting Net Assets with Multi-Scenario Modeling</p></div>
                   <div className="flex items-center gap-4">
                      <div className="flex bg-slate-100 rounded-xl p-1.5 text-sm font-bold shadow-inner">
                        {['2m', '3m', '6m', '1y'].map(p => (<button key={p} onClick={() => setPeriod(p as any)} className={`px-5 py-2 rounded-lg transition-all uppercase ${period === p ? 'bg-white shadow-md text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>{p}</button>))}
                      </div>
                      <button onClick={() => setShowScenariosPanel(!showScenariosPanel)} className={`p-3 rounded-xl border transition-all flex items-center gap-2 font-bold ${showScenariosPanel ? 'bg-slate-800 border-slate-900 text-white shadow-xl' : 'bg-white border-slate-200 text-slate-600 shadow-sm'}`}><Settings2 size={20}/> Sandbox</button>
                   </div>
                </div>
                <div className="h-[450px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={forecastData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="displayDate" tick={{fontSize: 11, fontWeight: 600, fill: '#64748b'}} axisLine={false} tickLine={false} interval={Math.floor(forecastData.length / 10)} />
                      <YAxis tick={{fontSize: 11, fontWeight: 600, fill: '#64748b'}} axisLine={false} tickLine={false} tickFormatter={(val) => formatCurrency(val, displayCurrency)} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle}
                        formatter={(v: number, name: string) => {
                            if (name === 'balance') return [formatCurrency(v, displayCurrency), 'Baseline Total Net'];
                            if (name === 'checkingBalance') return [formatCurrency(v, displayCurrency), 'Checking Balance (עו״ש)'];
                            
                            const [type, scenarioId] = name.split('_');
                            const sName = scenarios.find(s => s.id === scenarioId)?.name || 'Unknown';
                            const typeLabel = type === 'net' ? 'Total Net' : 'Checking (עו״ש)';
                            
                            return [formatCurrency(v, displayCurrency), `${sName}: ${typeLabel}`];
                        }} 
                      />
                      <Legend verticalAlign="top" height={50} wrapperStyle={{ paddingBottom: '20px' }}/>
                      <Area type="monotone" dataKey="balance" name="Baseline Total Net" stroke="#0ea5e9" strokeWidth={4} fillOpacity={0.05} fill="#0ea5e9" />
                      <Line type="monotone" dataKey="checkingBalance" name="Checking Balance (עו״ש)" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="3 3" />
                      
                      {scenarios.map(s => s.isActive && (
                          <React.Fragment key={s.id}>
                              <Line type="monotone" dataKey={`net_${s.id}`} name={`${s.name}: Total Net`} stroke={s.color} strokeWidth={3} strokeDasharray="5 5" dot={false} />
                              <Line type="monotone" dataKey={`check_${s.id}`} name={`${s.name}: Checking (עו״ש)`} stroke={s.color} strokeWidth={2} strokeDasharray="2 2" dot={false} opacity={0.7} />
                          </React.Fragment>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
             </div>

             {showScenariosPanel && (
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 animate-fade-in items-start">
                    <div className="xl:col-span-1 bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                        <div className="flex justify-between items-center"><h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Scenarios</h4><button onClick={addScenario} className="text-brand-600 hover:text-brand-700 font-bold text-xs flex items-center gap-1.5 bg-brand-50 px-3 py-1.5 rounded-xl"><Plus size={16}/> New</button></div>
                        <div className="space-y-3">
                            {scenarios.map(s => (
                                <div key={s.id} onClick={() => setActiveScenarioId(s.id)} className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${activeScenarioId === s.id ? 'bg-slate-800 text-white shadow-lg' : 'bg-slate-50 hover:bg-white'}`}>
                                    <div className="flex items-center gap-3 overflow-hidden"><div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: s.color }}></div><input value={s.name} onChange={(e) => updateScenario(s.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} className={`bg-transparent text-sm font-bold focus:outline-none w-full ${activeScenarioId === s.id ? 'text-white' : 'text-slate-700'}`} /></div>
                                    <div className="flex items-center gap-2"><input type="checkbox" checked={s.isActive} onChange={(e) => { e.stopPropagation(); updateScenario(s.id, { isActive: e.target.checked }); }} className="w-4 h-4 rounded text-brand-600" /></div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="xl:col-span-3 bg-white p-10 rounded-[2.5rem] border border-brand-100 shadow-md space-y-12">
                        <div className="flex items-center gap-6 border-b pb-8"><div className="p-4 bg-brand-50 text-brand-600 rounded-2xl"><Sliders size={28}/></div><div><h3 className="text-2xl font-black text-slate-800 tracking-tight">{activeScenario.name} Sandbox</h3><p className="text-slate-500 font-medium">Hypothetical impact modeling.</p></div></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            <div className="space-y-10">
                                <section className="space-y-6">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><PlayCircle size={18} className="text-brand-500"/> Variable Influences</h4>
                                    <div className="space-y-8 p-6 bg-slate-50 rounded-2xl border">
                                        <div className="space-y-4"><div className="flex justify-between items-center"><label className="text-sm font-bold text-slate-600">Global Expense Reduction</label><span className="bg-brand-100 text-brand-700 px-3 py-1 rounded-lg font-black text-xs">{activeScenario.expenseReduction}%</span></div><input type="range" min="0" max="50" step="5" value={activeScenario.expenseReduction} onChange={(e) => updateScenario(activeScenarioId, { expenseReduction: Number(e.target.value) })} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-500" /></div>
                                        <div className="space-y-3"><label className="text-sm font-bold text-slate-600">One-Time Financial Event (ILS)</label><input type="number" value={activeScenario.oneTimeIncome} onChange={(e) => updateScenario(activeScenarioId, { oneTimeIncome: Number(e.target.value) })} className="w-full p-3 bg-white border rounded-xl text-lg font-black outline-none focus:ring-4 focus:ring-brand-500/10 shadow-sm" placeholder="0.00" /></div>
                                    </div>
                                </section>
                                <section className="space-y-6">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Repeat size={18} className="text-purple-500"/> Recurring Overrides</h4>
                                    <div className="space-y-3 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                                        {recurring.filter(r => r.isActive).map(r => (
                                            <div key={r.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border shadow-sm">
                                                <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-700 truncate">{getPayeeName(r)}</div><div className="text-[10px] text-gray-400 font-bold">BASE: {formatCurrency(r.amount, displayCurrency)}</div></div>
                                                <input type="number" placeholder="New" value={activeScenario.recurringOverrides[r.id] || ''} onChange={e => {
                                                    const next = { ...activeScenario.recurringOverrides };
                                                    if (e.target.value === '') delete next[r.id]; else next[r.id] = parseFloat(e.target.value);
                                                    updateScenario(activeScenarioId, { recurringOverrides: next });
                                                }} className="w-28 p-2 bg-slate-50 border rounded-lg text-xs font-black" />
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                            <div className="space-y-10">
                                <section className="space-y-6">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Calendar size={18} className="text-orange-500"/> Planned Events (What-If)</h4>
                                    <div className="p-6 bg-orange-50/20 rounded-2xl border border-orange-100 space-y-6">
                                        <div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><label className="text-[10px] font-black text-slate-500 uppercase ml-1 tracking-wider">Date</label><input type="date" value={newTentativeDate} onChange={e => setNewTentativeDate(e.target.value)} className="w-full p-2.5 border rounded-lg text-xs font-bold" /></div><div className="space-y-1.5"><label className="text-[10px] font-black text-slate-500 uppercase ml-1 tracking-wider">Type</label><select value={newTentativeType} onChange={e => setNewTentativeType(e.target.value as any)} className="w-full p-2.5 border rounded-lg text-xs font-bold"><option value="expense">Expense (-)</option><option value="income">Income (+)</option></select></div></div>
                                        <div className="flex gap-3"><input type="text" placeholder="Payee" value={newTentativePayee} onChange={e => setNewTentativePayee(e.target.value)} className="flex-1 p-3 border rounded-xl text-xs font-bold" /><input type="number" placeholder="Amt" value={newTentativeAmount} onChange={e => setNewTentativeAmount(e.target.value)} className="w-24 p-3 border rounded-xl text-xs font-bold" /><button onClick={handleAddTentative} className="bg-slate-800 text-white px-4 rounded-xl shadow-md"><Plus size={20}/></button></div>
                                        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                            {activeScenario.tentativeTxs.map(t => (
                                                <div key={t.id} className="flex justify-between items-center bg-white p-4 rounded-xl border text-xs shadow-sm"><div className="flex flex-col"><span className="font-bold text-slate-700">{t.payee}</span><span className="text-[10px] text-slate-400 font-bold">{t.date}</span></div><div className="flex items-center gap-4"><span className={`font-black ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(t.amount, displayCurrency)}</span><button onClick={() => updateScenario(activeScenarioId, { tentativeTxs: activeScenario.tentativeTxs.filter(tx => tx.id !== t.id) })} className="text-slate-300 hover:text-red-500"><Trash2 size={16}/></button></div></div>
                                            ))}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
             )}

             <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-2"><Repeat size={20} className="text-brand-500"/> Future Payment Burden (Strict Installments)</h3>
                <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={installmentsSummary.roadmap} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" tick={{fontSize: 12, fontWeight: 700, fill: '#64748b'}} axisLine={false} tickLine={false} />
                            <YAxis tick={{fontSize: 11, fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val} />
                            <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle}
                                formatter={(val: number, name: string) => [formatCurrency(val, displayCurrency), name]} 
                            />
                            <Legend verticalAlign="top" iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />
                            {installmentsSummary.activePayees.map((payeeName, i) => (
                                <Bar key={payeeName} dataKey={payeeName} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} name={payeeName} />
                            ))}
                            <Bar dataKey="total" fill="transparent" stackId="a" isAnimationActive={false}>
                                <LabelList 
                                    dataKey="total" 
                                    position="top" 
                                    offset={10}
                                    formatter={(val: number) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val.toFixed(0)}
                                    style={{ fontSize: '11px', fontWeight: '900', fill: '#475569' }}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
             </div>
        </div>
    </div>
  );
};
