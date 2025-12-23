
import { createClient } from '@supabase/supabase-js';

const CONFIG_KEY = 'financeflow_supabase_config';

// Credentials are now pulled from environment variables.
// Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in Vercel settings.
const DEFAULT_URL = process.env.SUPABASE_URL || "";
const DEFAULT_KEY = process.env.SUPABASE_ANON_KEY || "";

export const getSupabaseConfig = () => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) {
        return { url: DEFAULT_URL, key: DEFAULT_KEY };
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

let supabaseInstance: any = null;

export const initSupabase = () => {
    if (supabaseInstance) return supabaseInstance;
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return null;
    
    supabaseInstance = createClient(url, key);
    return supabaseInstance;
};

export const resetSupabase = () => {
    supabaseInstance = null;
    localStorage.removeItem(CONFIG_KEY);
};
