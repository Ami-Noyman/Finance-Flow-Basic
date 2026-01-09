
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env vars regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  // BUILD-TIME LOGGING (Check Vercel Build Logs)
  console.warn("--- BUILD-TIME ENV CHECK ---");
  console.warn("Mode:", mode);
  console.warn("CWD:", process.cwd());
  console.warn("VITE_SUPABASE_URL (from loadEnv):", env.VITE_SUPABASE_URL ? "FOUND (Starts with " + env.VITE_SUPABASE_URL.substring(0, 10) + ")" : "MISSING");
  console.warn("SUPABASE_URL (from process.env):", process.env.SUPABASE_URL ? "FOUND" : "MISSING");
  console.warn("----------------------------");

  return {
    plugins: [react()],
    define: {
      // Direct global constants for reliable build-time injection
      '__SUPABASE_URL__': JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ""),
      '__SUPABASE_ANON_KEY__': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""),
      '__GEMINI_API_KEY__': JSON.stringify(env.VITE_GEMINI_API_KEY || env.API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || ""),

      // Map variations of process.env for legacy support in components/services
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || ""),
      'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || ""),
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ""),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""),
      'process.env.SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ""),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""),
    }
  };
});
