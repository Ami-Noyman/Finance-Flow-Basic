
import React from 'react';
import { X, HelpCircle, Info, Lightbulb, Target, BrainCircuit, ShieldCheck, Settings, List, LayoutDashboard, TrendingUp } from 'lucide-react';

interface HelpPanelProps {
  activeTab: string;
  isOpen: boolean;
  onClose: () => void;
}

const HELP_CONTENT: Record<string, {
  title: string;
  icon: React.ElementType;
  description: string;
  features: { title: string; text: string }[];
  tip: string;
}> = {
  dashboard: {
    title: 'לוח בקרה (Dashboard)',
    icon: LayoutDashboard,
    description: 'זהו מרכז הפיקוד הפיננסי שלך. כאן תוכל לראות תמונה מלאה של המצב הנוכחי והעתידי של הנכסים הנזילים.',
    features: [
      { title: 'גרף נכסים נזילים', text: 'מציג את היתרה המאוחדת של כל חשבונות העו״ש, כרטיסי האשראי והמזומן כברירת מחדל.' },
      { title: 'יתרות חשבון', text: 'פירוט יתרות לכל חשבון בנפרד, כולל מסגרות אשראי.' },
      { title: 'השוואה שנתית', text: 'ניתוח הכנסות מול הוצאות בכל חודש לאורך השנה.' }
    ],
    tip: 'לחץ על כפתור "Show Details" בגרף המגמה כדי לראות איך כל חשבון תורם לתזרים הכללי.'
  },
  transactions: {
    title: 'ניהול תנועות (Transactions)',
    icon: List,
    description: 'מסך זה מרכז את כל הפעולות הכספיות שבוצעו בחשבונות שלך.',
    features: [
      { title: 'עמודת R (התאמה)', text: 'השתמש בתיבת הסימון כדי לסמן תנועות שווידאת מול דף הבנק/אשראי.' },
      { title: 'קיטלוג AI', text: 'הזן שם בית עסק, והמערכת תנסה לקטלג אותו אוטומטית בעזרת בינה מלאכותית.' },
      { title: 'פילטרים מתקדמים', text: 'ניתן לסנן לפי תאריכים, סכומים, קטגוריות וחשבונות ספציפיים.' }
    ],
    tip: 'צריך להעביר כסף בין חשבונות? בחר בסוג תזרים "Transfer" כדי לא לפגוע בחישוב ההוצאות.'
  },
  recurring: {
    title: 'התחייבויות וגבולות הוצאה',
    icon: Target,
    description: 'כאן מנהלים את התשלומים הקבועים ואת מגבלות התקציב החכמות שלך.',
    features: [
      { title: 'התחייבויות (Commitments)', text: 'הגדר הוראות קבע, מנויים ותשלומים קבועים שיזינו את התחזית אוטומטית.' },
      { title: 'גבולות הוצאה (Spend Limits)', text: 'הגדר תקציב מקסימלי לקטגוריה (כמו מזון או מסעדות).' },
      { title: 'ממוצע חכם', text: 'המערכת יודעת לחשב מגבלת תקציב דינמית על סמך ממוצע ההוצאות שלך בשנה האחרונה.' }
    ],
    tip: 'תשלומים שמסתיימים בקרוב? הגדר מספר "Installments" והם ייעלמו מהתחזית במועד הסיום.'
  },
  forecast: {
    title: 'תחזית וארגז חול (Forecast)',
    icon: TrendingUp,
    description: 'המנוע שמראה לך איפה תהיה בעוד חודשיים, חצי שנה או שנה.',
    features: [
      { title: 'קו עו״ש אדום', text: 'גרף ייעודי שמזהה מתי חשבון העו״ש שלך עלול להיכנס למינוס.' },
      { title: 'ארגז חול (Sandbox)', text: 'בצע סימולציות של "מה אם" - הוספת הכנסה, הפחתת הוצאות או רכישה גדולה מתוכננת.' },
      { title: 'תרחישים (Scenarios)', text: 'צור מספר תרחישים (למשל: "טיול לחו״ל" מול "חיסכון מקסימלי") והשווה ביניהם.' }
    ],
    tip: 'השתמש ב-Expense Reduction בסימולציה כדי לראות כמה תוכל לחסוך אם תצמצם 10% מההוצאות המשתנות.'
  },
  ai: {
    title: 'יועץ AI אישי',
    icon: BrainCircuit,
    description: 'הכוח של Gemini מנתח את הנתונים שלך ומספק תובנות פיננסיות.',
    features: [
      { title: 'תובנות (Insights)', text: 'ניתוח אוטומטי של דפוסי הוצאה והזדמנויות לחיסכון.' },
      { title: 'צ׳אט יועץ', text: 'שאל שאלות כמו "כמה הוצאתי על מסעדות בחודש האחרון?" או "האם אני יכול להרשות לעצמי לקנות רכב חדש?"' }
    ],
    tip: 'ה-AI רואה את 50 התנועות האחרונות ואת כל ההתחייבויות שלך - היה ספציפי בשאלות!'
  },
  savings: {
    title: 'ניהול חסכונות',
    icon: Info,
    description: 'מעקב אחר נכסים לטווח ארוך כמו פיקדונות, קופות גמל וקרנות השתלמות.',
    features: [
      { title: 'צמיחה היסטורית', text: 'ראה איך ההון שלך גדל לאורך זמן.' },
      { title: 'חלוקת בעלות', text: 'ניהול נכסי המשפחה בנפרד בעזרת תצוגת Owners ייעודית.' },
      { title: 'מסלולי השקעה', text: 'ציין את מסלול ההשקעה לכל קופה למעקב מדויק יותר.' }
    ],
    tip: 'עדכן את היתרה בחיסכון פעם בחודש כדי לקבל גרף צמיחה מדויק. המערכת תחשב את התשואה אוטומטית.'
  },
  pension: {
    title: 'תכנון פנסיוני',
    icon: ShieldCheck,
    description: 'מעקב אחר העתיד הרחוק והביטחון הסוציאלי שלך.',
    features: [
      { title: 'קיצבה משוערת', text: 'המערכת מחשבת כמה תקבל בחודש בזמן פרישה.' },
      { title: 'צבירה כוללת', text: 'סיכום כל הקרנות והקופות הפנסיוניות במקום אחד, מופרד לפי בעלים (Owners Frames).' }
    ],
    tip: 'הנתונים נמצאים בדרך כלל בדו״ח השנתי שמתקבל מהקרן - מומלץ לעדכן את הקיצבה המשוערת משם.'
  },
  settings: {
    title: 'הגדרות ותחזוקה',
    icon: Settings,
    description: 'כאן מגדירים את התשתית של האפליקציה.',
    features: [
      { title: 'ניהול חשבונות', text: 'הוסף חשבונות חדשים, הגדר ימי חיוב לכרטיסי אשראי וקבע מאיזה חשבון יירד החיוב.' },
      { title: 'גיבוי ושחזור (BaaS Support)', text: 'ייצא את כל הנתונים לקובץ JSON הכולל את שם השרת (כמו Supabase) לגיבוי בטוח.' },
      { title: 'חילוץ נתונים (Legacy Rescue)', text: 'כלי חכם לשחזור תקציבים ונתוני היסטוריה מקבצים ישנים או טקסט גולמי.' }
    ],
    tip: 'מחקת משהו בטעות? השתמש בכלי ה-Legacy Recovery בטאב ה-Data כדי לנסות לשחזר "גבולות הוצאה" מקבצי גיבוי ישנים.'
  }
};

export const HelpPanel: React.FC<HelpPanelProps> = ({ activeTab, isOpen, onClose }) => {
  const content = HELP_CONTENT[activeTab] || HELP_CONTENT.dashboard;
  const Icon = content.icon;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      <div className="absolute inset-y-0 right-0 max-w-full flex">
        <div className="w-screen max-w-md transform transition-all animate-slide-left h-full bg-white shadow-2xl flex flex-col" dir="rtl">
          {/* Header */}
          <div className="px-6 py-6 border-b border-gray-100 flex justify-between items-center bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand-600 text-white rounded-xl shadow-lg shadow-brand-500/20">
                <HelpCircle size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-800 tracking-tight">מרכז העזרה</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Contextual Assistance</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
              <X size={24} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* Active Context Section */}
            <section className="space-y-4">
              <div className="flex items-center gap-3 text-brand-600">
                <Icon size={20} />
                <h3 className="font-black text-lg">{content.title}</h3>
              </div>
              <p className="text-slate-600 font-medium leading-relaxed">
                {content.description}
              </p>
            </section>

            {/* Features List */}
            <section className="space-y-5">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-2">מה ניתן לעשות כאן?</h4>
              <div className="space-y-4">
                {content.features.map((f, i) => (
                  <div key={i} className="flex gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-brand-200 transition-all">
                    <div className="mt-1 p-1 bg-white rounded-lg text-brand-500 shadow-sm border border-slate-100">
                      <Info size={14} />
                    </div>
                    <div>
                      <h5 className="font-black text-slate-800 text-sm mb-1">{f.title}</h5>
                      <p className="text-xs text-slate-500 font-bold leading-normal">{f.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Pro Tip */}
            <section className="bg-orange-50 p-6 rounded-2xl border border-orange-100 relative overflow-hidden group">
              <div className="absolute -top-4 -left-4 text-orange-200/50 group-hover:scale-110 transition-transform">
                <Lightbulb size={80} />
              </div>
              <div className="relative">
                <div className="flex items-center gap-2 text-orange-600 mb-2">
                  <Lightbulb size={18} />
                  <span className="font-black text-xs uppercase tracking-widest">טיפ ממקצוענים</span>
                </div>
                <p className="text-sm font-bold text-orange-800 leading-relaxed">
                  {content.tip}
                </p>
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-100 bg-slate-50 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">FinanceFlow Help System v2.2</p>
          </div>
        </div>
      </div>
    </div>
  );
};
