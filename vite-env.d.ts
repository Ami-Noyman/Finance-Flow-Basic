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

// Global build-time constants injected by Vite (defined in vite.config.ts)
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __GEMINI_API_KEY__: string;

// Window augmentation for components that check for process.env
interface Window {
    process?: {
        env: {
            [key: string]: string | undefined;
        }
    }
}
