
import { createClient } from '@supabase/supabase-js';

const CONFIG_KEY = 'financeflow_supabase_config';

// User provided defaults
const DEFAULT_URL = "https://lkiaivglqrjnfknqgzjv.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxraWFpdmdscXJqbmZrbnFnemp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTgzNzQsImV4cCI6MjA4MTI5NDM3NH0.1vpgJx-NUmwsyPrcQc79VK6ktJv6rdQP_YqbqKjMWgQ";

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
    // We assume it's configured since we have defaults, 
    // but check if user has manually cleared or if key looks valid.
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
