
import { RecurringTransaction, Transaction, Frequency, AmountType, SmartCategoryBudget, Account } from '../types';
import { addDays, addWeeks, addMonths, addYears, parseISO, startOfMonth, endOfMonth, isWithinInterval, format, subMonths, differenceInCalendarMonths, isBefore, isSameDay, startOfDay } from 'date-fns';

/**
 * Sorts accounts by priority: Checking (עו״ש) -> Credit Cards -> Cash -> Others
 */
export const sortAccounts = (accounts: Account[]): Account[] => {
  return [...accounts].sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    
    const isOshA = nameA.includes('עו״ש') || nameA.includes('עוש') || a.type === 'checking';
    const isOshB = nameB.includes('עו״ש') || nameB.includes('עוש') || b.type === 'checking';
    
    // Priority 1: Checking
    if (isOshA && !isOshB) return -1;
    if (!isOshA && isOshB) return 1;

    // Priority 2: Credit Cards
    if (a.type === 'credit' && b.type !== 'credit') return -1;
    if (a.type !== 'credit' && b.type === 'credit') return 1;

    // Priority 3: Cash
    if (a.type === 'cash' && b.type !== 'cash') return -1;
    if (a.type !== 'cash' && b.type === 'cash') return 1;

    // Alphabetical for same priority
    return nameA.localeCompare(nameB);
  });
};

export const calculateNextDate = (
  date: Date, 
  frequency: Frequency, 
  customInterval: number = 1, 
  customUnit: 'day' | 'week' | 'month' | 'year' = 'month'
): Date => {
  const safeInterval = Math.max(1, customInterval || 1);

  switch (frequency) {
    case Frequency.WEEKLY: return addWeeks(date, 1);
    case Frequency.BIWEEKLY: return addWeeks(date, 2);
    case Frequency.MONTHLY: return addMonths(date, 1);
    case Frequency.BIMONTHLY: return addMonths(date, 2);
    case Frequency.QUARTERLY: return addMonths(date, 3);
    case Frequency.YEARLY: return addYears(date, 1);
    case Frequency.CUSTOM:
      switch (customUnit) {
        case 'day': return addDays(date, safeInterval);
        case 'week': return addWeeks(date, safeInterval);
        case 'month': return addMonths(date, safeInterval);
        case 'year': return addYears(date, safeInterval);
        default: return addMonths(date, safeInterval);
      }
    default: return addMonths(date, 1);
  }
};

export const getSmartAmount = (r: RecurringTransaction, targetDate: Date, history: Transaction[]): number => {
  if (!r.amountType || r.amountType === AmountType.FIXED) return r.amount;
  const matches = history.filter(t => (t.payee === r.payee || (t as any).description === r.payee) && t.type === r.type);
  if (r.amountType === AmountType.AVERAGE) {
      if (matches.length === 0) return r.amount;
      const sum = matches.reduce((acc, t) => acc + t.amount, 0);
      return sum / matches.length;
  }
  if (r.amountType === AmountType.LAST_YEAR) {
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear() - 1;
      const match = matches.find(t => {
         const d = parseISO(t.date);
         return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
      });
      return match ? match.amount : r.amount;
  }
  return r.amount;
};

/**
 * Calculates upcoming committed spend for a category within the remainder of the current month.
 */
export const calculateRemainingCommittedSpend = (category: string, recurring: RecurringTransaction[], history: Transaction[]): number => {
    const today = startOfDay(new Date());
    const monthEnd = endOfMonth(today);
    let committedTotal = 0;

    recurring.filter(r => r.isActive && r.category === category && r.type === 'expense').forEach(r => {
        let simDate = parseISO(r.nextDueDate);
        let processedCount = r.occurrencesProcessed || 0;
        
        // Walk through the occurrences for the remainder of this month
        while ((isBefore(simDate, monthEnd) || isSameDay(simDate, monthEnd)) && (!isBefore(simDate, today))) {
            if (r.totalOccurrences && processedCount >= r.totalOccurrences) break;
            
            committedTotal += getSmartAmount(r, simDate, history);
            simDate = calculateNextDate(simDate, r.frequency, r.customInterval, r.customUnit);
            processedCount++;
        }
    });

    return committedTotal;
};

export const calculateCategoryMonthlyAverage = (category: string, history: Transaction[], monthsToAverage: number = 12): number => {
  const now = new Date();
  const totalsByMonth: Record<string, number> = {};
  
  for (let i = 0; i < monthsToAverage; i++) {
    const targetMonthDate = subMonths(now, i);
    const monthKey = format(targetMonthDate, 'yyyy-MM');
    totalsByMonth[monthKey] = 0;
  }

  let earliestDate: Date | null = null;

  history.forEach(t => {
    if (t.category === category && t.type === 'expense') {
      const tDate = parseISO(t.date);
      const monthKey = format(tDate, 'yyyy-MM');
      if (totalsByMonth[monthKey] !== undefined) {
        totalsByMonth[monthKey] += t.amount;
        if (!earliestDate || tDate < earliestDate) earliestDate = tDate;
      }
    }
  });

  const monthValues = Object.values(totalsByMonth);
  const totalSpent = monthValues.reduce((a, b) => a + b, 0);
  
  if (totalSpent === 0) return 0;

  let divisor = monthsToAverage;
  if (earliestDate) {
    const monthsElapsed = differenceInCalendarMonths(now, earliestDate) + 1;
    divisor = Math.min(monthsToAverage, Math.max(1, monthsElapsed));
  }

  return totalSpent / divisor;
};

export const getEffectiveCategoryBudget = (budget: SmartCategoryBudget, history: Transaction[]): number => {
  if (budget.useAverage) {
    const avg = calculateCategoryMonthlyAverage(budget.categoryName, history);
    return avg > 0 ? avg : budget.monthlyLimit;
  }
  return budget.monthlyLimit;
};
