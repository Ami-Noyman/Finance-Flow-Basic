/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly VITE_GEMINI_API_KEY: string
    readonly SUPABASE_URL?: string
    readonly SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Global build-time constants injected by Vite
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __GEMINI_API_KEY__: string;

declare var process: {
    env: {
        API_KEY?: string;
        VITE_GEMINI_API_KEY?: string;
        VITE_SUPABASE_URL?: string;
        VITE_SUPABASE_ANON_KEY?: string;
        SUPABASE_URL?: string;
        SUPABASE_ANON_KEY?: string;
        [key: string]: string | undefined;
    }
};
