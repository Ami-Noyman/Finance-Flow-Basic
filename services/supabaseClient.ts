
import { createClient } from '@supabase/supabase-js';

const CONFIG_KEY = 'financeflow_supabase_config';

// Detect environment variables from Vite or process.env (Vercel)
const ENV_URL = import.meta.env.VITE_SUPABASE_URL ||
    (import.meta.env as any).SUPABASE_URL ||
    (typeof process !== 'undefined' ? process.env.SUPABASE_URL : "") ||
    "";

const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ||
    (import.meta.env as any).SUPABASE_ANON_KEY ||
    (typeof process !== 'undefined' ? process.env.SUPABASE_ANON_KEY : "") ||
    "";

/**
 * Returns true if the environment variables are already set (e.g. on Vercel or local .env)
 */
export const isPreconfigured = () => {
    return !!(ENV_URL && (ENV_URL !== "your_supabase_url") && ENV_KEY && (ENV_KEY !== "your_supabase_anon_key"));
};

export const getSupabaseConfig = () => {
    // If we have environment variables, they take absolute priority
    if (isPreconfigured()) {
        return { url: ENV_URL, key: ENV_KEY };
    }

    // Otherwise, check local storage (for AI Studio/Local development)
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) {
        return { url: "", key: "" };
    }
    return JSON.parse(stored);
};

export const saveSupabaseConfig = (config: { url: string; key: string }) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

export const isConfigured = () => {
    const config = getSupabaseConfig();
    return !!(config.url && config.key);
};

export const getDebugInfo = () => {
    const config = getSupabaseConfig();
    return {
        hasUrl: !!config.url,
        hasKey: !!config.key,
        urlPreview: config.url ? `${config.url.substring(0, 12)}...` : 'NONE',
        source: isPreconfigured() ? 'Environment (Vercel)' : (isConfigured() ? 'Local Storage' : 'NOT CONFIGURED')
    };
};

let supabaseInstance: any = null;

export const initSupabase = () => {
    if (supabaseInstance) return supabaseInstance;
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return null;

    try {
        supabaseInstance = createClient(url, key);
        return supabaseInstance;
    } catch (e) {
        console.error("Supabase Initialization Error:", e);
        return null;
    }
};

export const resetSupabase = () => {
    supabaseInstance = null;
    localStorage.removeItem(CONFIG_KEY);
};
