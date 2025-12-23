
export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
}

export enum Frequency {
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  MONTHLY = 'monthly',
  BIMONTHLY = 'bimonthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
  CUSTOM = 'custom'
}

export enum AmountType {
  FIXED = 'fixed',
  AVERAGE = 'average',
  LAST_YEAR = 'last_year'
}

export interface Valuation {
  id: string;
  accountId: string;
  date: string;
  value: number;
}

export interface Account {
  id: string;
  name: string;
  owner?: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'cash' | 'pension';
  subType?: string;
  currency: string;
  color: string;
  initialBalance: number; 
  creditLimit?: number;
  paymentDay?: number;
  payFromAccountId?: string;
  lastPaymentDate?: string;
  investmentTrack?: string;
  estimatedPension?: number;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  payee: string;
  notes?: string;
  category: string;
  type: TransactionType;
  accountId: string;
  toAccountId?: string;
  isRecurring?: boolean;
  recurringId?: string;
  isReconciled?: boolean;
}

export interface RecurringTransaction {
  id: string;
  amount: number;
  amountType?: AmountType;
  payee: string;
  notes?: string;
  category: string;
  type: TransactionType;
  accountId: string;
  toAccountId?: string;
  frequency: Frequency;
  customInterval?: number;
  customUnit?: 'day' | 'week' | 'month' | 'year';
  startDate: string;
  nextDueDate: string;
  isActive: boolean;
  totalOccurrences?: number;
  occurrencesProcessed?: number;
}

export interface SmartCategoryBudget {
  id: string;
  categoryName: string;
  monthlyLimit: number;
  useAverage: boolean;
  isActive: boolean;
}

export interface ForecastPoint {
  date: string;
  balance: number;
  checkingBalance: number;
  [key: string]: any;
}

export interface AppState {
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: string[];
  categoryBudgets: SmartCategoryBudget[];
  valuations: Valuation[];
}
