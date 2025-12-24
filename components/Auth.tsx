
import React, { useState, useEffect } from 'react';
import { initSupabase, saveSupabaseConfig, isConfigured, resetSupabase, isPreconfigured, getDebugInfo } from '../services/supabaseClient';
import { Settings, LogIn, UserPlus, AlertCircle, CheckCircle, Database, Loader, Mail, Send, Eye, EyeOff, KeyRound, ArrowLeft, AlertTriangle } from 'lucide-react';

interface AuthProps {
    onConfigured: () => void;
    onAuthCheck?: () => void;
}

const EMAILS_STORAGE_KEY = 'financeflow_remembered_emails';

export const Auth: React.FC<AuthProps> = ({ onConfigured, onAuthCheck }) => {
    const configured = isConfigured();
    const preconfigured = isPreconfigured();
    const debug = getDebugInfo();
    
    // If preconfigured (Vercel), we never start in 'config' mode.
    // Otherwise (AI Studio), if not configured, start in 'config' mode.
    const [mode, setMode] = useState<'login' | 'register' | 'config' | 'reset'>(
        preconfigured ? 'login' : (configured ? 'login' : 'config')
    );
    
    const [rememberedEmails, setRememberedEmails] = useState<string[]>([]);
    
    // Auth Form State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [configSuccess, setConfigSuccess] = useState(false);
    
    // Config Form State
    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [supabaseKey, setSupabaseKey] = useState('');

    useEffect(() => {
        const stored = localStorage.getItem(EMAILS_STORAGE_KEY);
        if (stored) setRememberedEmails(JSON.parse(stored));
    }, []);

    const saveRecentEmail = (email: string) => {
        const updated = [...new Set([email.trim(), ...rememberedEmails])].slice(0, 5);
        localStorage.setItem(EMAILS_STORAGE_KEY, JSON.stringify(updated));
        setRememberedEmails(updated);
    };

    const handleConfigSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const cleanUrl = supabaseUrl.trim().replace(/\/$/, ""); 
            const cleanKey = supabaseKey.trim();
            
            const config = { url: cleanUrl, key: cleanKey };
            if (!config.url || !config.key) throw new Error("Missing required configuration fields.");
            
            resetSupabase();
            saveSupabaseConfig(config);
            
            const testClient = initSupabase();
            if (!testClient) throw new Error("Supabase initialization failed.");
            
            setConfigSuccess(true); setLoading(false); 
            onConfigured();
            setTimeout(() => { setMode('login'); setConfigSuccess(false); }, 1500);
        } catch (err: any) {
            setError(err.message || "Failed to save configuration.");
            setLoading(false);
        }
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setSuccessMsg(null); setLoading(true);
        const supabase = initSupabase();
        if (!supabase) { setError("Connection not configured properly. Check environment variables."); setLoading(false); return; }
        const cleanEmail = email.trim();
        if (!cleanEmail || !password) { setError("Email and password required."); setLoading(false); return; }

        try {
            if (mode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
                if (error) throw error;
                saveRecentEmail(cleanEmail);
            } else {
                const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
                if (error) throw error;
                setSuccessMsg("Check your email for the confirmation link!");
                saveRecentEmail(cleanEmail);
            }
        } catch (err: any) {
            setError(err.message || "Authentication error.");
        } finally { setLoading(false); }
    };

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setSuccessMsg(null); setLoading(true);
        const supabase = initSupabase();
        if (!supabase) { setError("Connection not configured."); setLoading(false); return; }
        const cleanEmail = email.trim();
        if (!cleanEmail) { setError("Email address is required."); setLoading(false); return; }

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
            if (error) throw error;
            setSuccessMsg("Reset link sent! Please check your inbox.");
        } catch (err: any) {
            setError(err.message || "Error sending reset email.");
        } finally { setLoading(false); }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="bg-white border-b border-gray-100 p-2 flex">
                    <button onClick={() => setMode('login')} disabled={loading} className={`flex-1 py-3 text-sm font-bold transition-colors ${mode === 'login' || mode === 'reset' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-gray-400 hover:text-gray-600'}`}>Sign In</button>
                    <button onClick={() => setMode('register')} disabled={loading} className={`flex-1 py-3 text-sm font-bold transition-colors ${mode === 'register' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-gray-400 hover:text-gray-600'}`}>Register</button>
                    
                    {/* ONLY SHOW CONFIG TAB IF NOT PRECONFIGURED VIA ENV VARS */}
                    {!preconfigured && (
                        <button onClick={() => setMode('config')} disabled={loading} className={`flex-1 py-3 text-sm font-bold transition-colors ${mode === 'config' ? 'text-brand-600 border-b-2 border-brand-600' : 'text-gray-400 hover:text-gray-600'}`}>Config</button>
                    )}
                </div>

                <div className="p-8">
                    {/* PRODUCTION CONNECTION GUARD */}
                    {(!debug.hasUrl || !debug.hasKey) && mode !== 'config' && (
                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 flex gap-3 items-start animate-pulse">
                            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20}/>
                            <div className="text-xs">
                                <p className="font-black text-amber-900 uppercase tracking-tight">Supabase Connection Missing</p>
                                <p className="text-amber-800 mt-1">Environment variables (<code>SUPABASE_URL</code>) are not detected. Login will fail.</p>
                            </div>
                        </div>
                    )}

                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-brand-100 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                            {mode === 'config' ? <Settings size={32}/> : (mode === 'reset' ? <KeyRound size={32}/> : <Database size={32}/>)}
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">
                            {mode === 'config' ? 'Supabase Connection' : 
                             (mode === 'reset' ? 'Reset Password' : 
                             (mode === 'login' ? 'Welcome Back' : 'Join Us'))}
                        </h2>
                    </div>

                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 flex items-start gap-2 border border-red-100"><AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
                    {successMsg && <div className="bg-green-50 text-green-600 p-3 rounded-lg text-sm mb-6 flex items-start gap-2 border border-green-200"><Mail size={16} className="mt-0.5 shrink-0"/><span>{successMsg}</span></div>}
                    {configSuccess && <div className="bg-green-50 text-green-700 p-4 rounded-lg text-sm mb-6 flex items-center gap-2 justify-center border border-green-200 font-bold"><CheckCircle size={18} /><span>Connected!</span></div>}

                    {mode === 'config' ? (
                        <form onSubmit={handleConfigSave} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1 uppercase">Supabase URL</label>
                                <input required placeholder="https://xyz.supabase.co" value={supabaseUrl} onChange={e => setSupabaseUrl(e.target.value)} disabled={loading} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1 uppercase">Anon Key</label>
                                <textarea required placeholder="Paste Key Here..." value={supabaseKey} onChange={e => setSupabaseKey(e.target.value)} disabled={loading} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 h-32" />
                            </div>
                            <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors mt-4 flex items-center justify-center gap-2 shadow-lg">{loading ? <Loader size={18} className="animate-spin" /> : 'Save Config'}</button>
                        </form>
                    ) : mode === 'reset' ? (
                        <div className="space-y-4">
                            <form onSubmit={handlePasswordReset} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1 ml-1 uppercase">Email Address</label>
                                    <input 
                                        type="email" 
                                        required 
                                        autoComplete="email"
                                        value={email} 
                                        onChange={e=>setEmail(e.target.value)}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500"
                                        placeholder="you@example.com"
                                    />
                                </div>
                                <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors mt-2 flex items-center justify-center gap-2 shadow-lg">{loading ? <Loader size={18} className="animate-spin"/> : <Send size={18}/>} {loading ? 'Sending...' : 'Send Reset Link'}</button>
                            </form>
                            <button 
                                onClick={() => { setMode('login'); setError(null); setSuccessMsg(null); }}
                                className="w-full text-center text-sm font-bold text-gray-500 hover:text-brand-600 flex items-center justify-center gap-2 transition-colors mt-4"
                            >
                                <ArrowLeft size={16} /> Back to Sign In
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <form onSubmit={handleAuth} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1 ml-1 uppercase">Email Address</label>
                                    <input 
                                        type="email" 
                                        required 
                                        autoComplete="email"
                                        list="recent-emails"
                                        value={email} 
                                        onChange={e=>setEmail(e.target.value)}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500"
                                        placeholder="you@example.com"
                                    />
                                    <datalist id="recent-emails">
                                        {rememberedEmails.map(rem => <option key={rem} value={rem} />)}
                                    </datalist>
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-1 ml-1">
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Password</label>
                                        {mode === 'login' && (
                                            <button 
                                                type="button"
                                                onClick={() => { setMode('reset'); setError(null); setSuccessMsg(null); }}
                                                className="text-[10px] font-black text-brand-600 uppercase tracking-widest hover:underline"
                                            >
                                                Forgot Password?
                                            </button>
                                        )}
                                    </div>
                                    <div className="relative">
                                        <input 
                                            type={showPassword ? "text" : "password"} 
                                            required 
                                            autoComplete="current-password"
                                            value={password} 
                                            onChange={e=>setPassword(e.target.value)}
                                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-500 pr-10"
                                            placeholder="••••••••"
                                        />
                                        <button 
                                            type="button" 
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-500 transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>
                                <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors mt-2 flex items-center justify-center gap-2 shadow-lg">{loading ? <Loader size={18} className="animate-spin"/> : <LogIn size={18}/>} {loading ? 'Processing...' : (mode === 'login' ? 'Sign In' : 'Register')}</button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
