
import React from 'react';
import { LayoutDashboard, List, Repeat, TrendingUp, PieChart, Settings as SettingsIcon, PiggyBank, ShieldCheck, BrainCircuit } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions', label: 'Transactions', icon: List },
    { id: 'recurring', label: 'Recurring', icon: Repeat },
    { id: 'forecast', label: 'Forecast', icon: TrendingUp },
    { id: 'ai', label: 'AI Advisor', icon: BrainCircuit },
    { id: 'savings', label: 'Savings', icon: PiggyBank },
    { id: 'pension', label: 'Pension', icon: ShieldCheck },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="w-20 lg:w-64 bg-slate-900 h-full flex flex-col flex-shrink-0 transition-all duration-300 shadow-xl z-20">
      <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800 bg-slate-950">
        <div className="bg-white/10 p-1.5 rounded-lg mr-0 lg:mr-3">
          <PieChart className="text-orange-500" size={20} />
        </div>
        <div>
            <h1 className="text-white font-bold text-xl hidden lg:block">FinanceFlow</h1>
            <span className="text-[10px] text-slate-400 hidden lg:block font-mono tracking-wider">Cloud Ed.</span>
        </div>
      </div>

      <nav className="flex-1 py-6 space-y-2 px-3 overflow-y-auto custom-scrollbar">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center p-3 rounded-lg transition-all duration-200 group
                ${isActive 
                  ? 'bg-orange-600 text-white shadow-md' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }
              `}
            >
              <Icon size={22} className={`min-w-[22px] ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} />
              <span className={`ml-3 font-medium hidden lg:block ${isActive ? 'text-white' : ''}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-800">
        <p className="text-xs text-slate-500 text-center lg:text-left hidden lg:block">
          &copy; 2024 FinanceFlow
        </p>
      </div>
    </div>
  );
};
