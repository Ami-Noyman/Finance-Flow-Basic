
import { createClient } from '@supabase/supabase-js';

// Detect environment variables from Vite or process.env (Vercel)
const ENV_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : "") || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : "");
const ENV_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : "") || (typeof process !== 'undefined' ? process.env.SUPABASE_ANON_KEY : "");

/**
 * Returns true if the environment variables are already set (e.g. on Vercel or local .env)
 */
export const isPreconfigured = () => {
    return !!ENV_URL && !!ENV_KEY;
};

/**
 * Loads configuration from Local Storage or Environment
 */
export const getSupabaseConfig = () => {
    // 1. Priority: Environment Variables (Vercel/Local .env)
    if (isPreconfigured()) {
        return {
            url: ENV_URL,
            key: ENV_KEY
        };
    }

    // 2. Fallback: Local Storage
    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');
    return { url, key };
};

/**
 * Check if client is actually configured
 */
export const isConfigured = () => {
    const { url, key } = getSupabaseConfig();
    return !!url && !!key;
};

const { url: finalUrl, key: finalKey } = getSupabaseConfig();
export const supabase = createClient(finalUrl || 'https://placeholder.supabase.co', finalKey || 'placeholder');

/**
 * Helper to get/init the singleton client (used by App.tsx and Auth.tsx)
 */
export const initSupabase = () => {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return null;
    return supabase; // Return the singleton
};

/**
 * Legacy support/Manual config save
 */
export const saveSupabaseConfig = (config: { url: string; key: string }) => {
    localStorage.setItem('supabase_url', config.url);
    localStorage.setItem('supabase_key', config.key);
};

export const resetSupabase = () => {
    localStorage.removeItem('supabase_url');
    localStorage.removeItem('supabase_key');
    window.location.reload();
};

export const getDebugInfo = () => {
    const config = getSupabaseConfig();
    return {
        urlValue: config.url || 'NONE',
        keyPreview: (config.url && config.key) ? `${config.key.substring(0, 10)}...` : 'NONE',
        hasUrl: !!config.url,
        hasKey: !!config.key,
        source: isPreconfigured() ? 'Environment' : (isConfigured() ? 'Local Storage' : 'NOT CONFIGURED'),
        envVariables: {
            VITE_SUPABASE_URL: !!(typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL),
            SUPABASE_URL: !!(typeof process !== 'undefined' && process.env.SUPABASE_URL)
        }
    };
};
