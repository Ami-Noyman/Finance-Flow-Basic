
import React, { useState, useEffect } from 'react';
import { FinancialGoal, Account } from '../types';
import { Plus, Target, Calendar, Trash2, Edit2, Info, CheckCircle, Wallet, X, Save, AlertCircle, Server } from 'lucide-react';
import { formatCurrency } from '../utils/currency';
import { checkTableHealth } from '../services/storageService';

interface GoalsManagerProps {
  goals: FinancialGoal[];
  accounts: Account[];
  onSaveGoal: (g: FinancialGoal) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export const GoalsManager: React.FC<GoalsManagerProps> = ({ goals, accounts, onSaveGoal, onDeleteGoal }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isTableMissing, setIsTableMissing] = useState(false);
  
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('');
  const [deadline, setDeadline] = useState('');
  const [color, setColor] = useState('#0ea5e9');
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    checkTableHealth().then(health => {
      if (health.goals === false) setIsTableMissing(true);
    });
  }, []);

  const handleOpenModal = (g?: FinancialGoal) => {
    if (g) {
      setEditingId(g.id); setName(g.name); setTarget(g.targetAmount.toString());
      setCurrent(g.currentAmount.toString()); setDeadline(g.deadline || '');
      setColor(g.color); setAccountId(g.accountId || '');
    } else {
      setEditingId(null); setName(''); setTarget(''); setCurrent(''); setDeadline('');
      setColor('#' + Math.floor(Math.random()*16777215).toString(16));
      setAccountId(accounts.find(a => a.type === 'savings')?.id || '');
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !target) return;
    const goal: FinancialGoal = {
      id: editingId || crypto.randomUUID(),
      name,
      targetAmount: parseFloat(target),
      currentAmount: parseFloat(current) || 0,
      deadline,
      color,
      accountId: accountId || undefined,
      isActive: true
    };
    await onSaveGoal(goal);
    setIsModalOpen(false);
  };

  if (isTableMissing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 bg-white rounded-3xl border border-red-100 shadow-sm animate-fade-in">
          <div className="p-6 bg-red-50 text-red-600 rounded-3xl mb-6"><AlertCircle size={48}/></div>
          <h3 className="text-2xl font-black text-slate-800">Database Setup Required</h3>
          <p className="text-slate-500 font-medium max-w-md mt-2 mb-8">The "Goals" table hasn't been created in your Supabase database yet. This is required to save your saving targets.</p>
          <div className="flex gap-4">
              <a href="#settings" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' })); }} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:bg-slate-800 transition-all">
                  <Server size={20}/> Go to DB Settings
              </a>
          </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Financial Goals</h2>
          <p className="text-sm text-slate-500 font-medium">Virtual sinking funds and saving targets</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg transition-all active:scale-95">
          <Plus size={20}/> New Goal
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {goals.map(goal => {
          const percent = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
          return (
            <div key={goal.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm group hover:border-brand-300 transition-all flex flex-col">
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-2xl" style={{ backgroundColor: `${goal.color}20`, color: goal.color }}><Target size={24}/></div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                   <button onClick={() => handleOpenModal(goal)} className="p-2 text-slate-400 hover:text-brand-600"><Edit2 size={16}/></button>
                   <button onClick={() => onDeleteGoal(goal.id)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={16}/></button>
                </div>
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-1">{goal.name}</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">
                {goal.accountId ? `In: ${accounts.find(a => a.id === goal.accountId)?.name}` : 'General Target'}
              </p>
              
              <div className="space-y-4 mt-auto">
                <div className="flex justify-between items-end">
                  <div className="text-[10px] font-black text-slate-400 uppercase">Progress</div>
                  <div className="text-right">
                    <span className="text-lg font-black text-slate-900">{formatCurrency(goal.currentAmount)}</span>
                    <span className="text-xs text-slate-400 font-bold ml-1">/ {formatCurrency(goal.targetAmount)}</span>
                  </div>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${percent}%`, backgroundColor: goal.color }} />
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-50">
                  <div className="text-[10px] font-black text-slate-500 flex items-center gap-1"><Calendar size={12}/> {goal.deadline || 'No deadline'}</div>
                  <div className="text-xs font-black" style={{ color: goal.color }}>{percent.toFixed(0)}% Complete</div>
                </div>
              </div>
            </div>
          );
        })}
        {goals.length === 0 && (
          <div className="col-span-full py-20 flex flex-col items-center text-center bg-gray-50 border-4 border-dashed border-slate-100 rounded-[3rem]">
            <div className="p-6 bg-white rounded-3xl shadow-sm text-slate-200 mb-4"><Target size={48}/></div>
            <h4 className="text-lg font-black text-slate-700">No Goals Defined</h4>
            <p className="text-sm text-slate-500 max-w-xs mb-8">Start setting aside money for specific needs like a new car, vacation, or emergency fund.</p>
            <button onClick={() => handleOpenModal()} className="bg-slate-800 text-white px-8 py-3 rounded-2xl font-black">Get Started</button>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-8 border-b bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-black text-xl text-slate-900">{editingId ? 'Update' : 'Create'} Savings Goal</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Goal Name</label>
                <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Electric Bike" className="w-full p-3 border rounded-xl font-bold" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Target Amount</label>
                   <input type="number" required value={target} onChange={e => setTarget(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl font-bold" />
                 </div>
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Current Saved</label>
                   <input type="number" value={current} onChange={e => setCurrent(e.target.value)} placeholder="0.00" className="w-full p-3 border rounded-xl font-bold" />
                 </div>
              </div>
              <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Account Partition</label>
                 <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full p-3 border rounded-xl font-bold bg-white">
                   <option value="">No specific account</option>
                   {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                 </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Deadline Date</label>
                   <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full p-3 border rounded-xl font-bold" />
                 </div>
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5 ml-1">Theme Color</label>
                   <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-full h-12 p-1 border rounded-xl bg-white" />
                 </div>
              </div>
              <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-2xl font-black shadow-lg flex items-center justify-center gap-2 transition-all">
                <Save size={20}/> Persist Goal
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
