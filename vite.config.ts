
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

// Manual .env parser fallback
function getManualEnv(cwd: string) {
  const envPath = path.join(cwd, '.env');
  const env: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split(/\r?\n/).forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
      console.warn("Manual .env Load: Success (Found " + Object.keys(env).length + " keys)");
    } catch (e) {
      console.warn("Manual .env Load: Failed to read file", e);
    }
  } else {
    console.warn("Manual .env Load: .env file not found at " + envPath);
    try {
      const files = fs.readdirSync(cwd);
      console.warn("Root Directory Contents:", files.join(', '));
    } catch (e) {
      console.warn("Failed to list directory contents", e);
    }
  }
  return env;
}

export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');
  const manualEnv = getManualEnv(cwd);

  // Combine all sources: loadEnv results, process.env, and manual parse results
  const mergedEnv = { ...process.env, ...env, ...manualEnv };

  // BUILD-TIME LOGGING (Check Vercel Build Logs)
  console.warn("--- BUILD-TIME ENV CHECK ---");
  console.warn("Mode:", mode);
  console.warn("CWD:", cwd);
  console.warn("VITE_SUPABASE_URL (Merged):", mergedEnv.VITE_SUPABASE_URL ? "FOUND (Starts with " + mergedEnv.VITE_SUPABASE_URL.substring(0, 10) + ")" : "MISSING");
  console.warn("----------------------------");

  return {
    plugins: [react()],
    define: {
      // Direct global constants for reliable build-time injection
      '__SUPABASE_URL__': JSON.stringify(mergedEnv.VITE_SUPABASE_URL || mergedEnv.SUPABASE_URL || ""),
      '__SUPABASE_ANON_KEY__': JSON.stringify(mergedEnv.VITE_SUPABASE_ANON_KEY || mergedEnv.SUPABASE_ANON_KEY || ""),
      '__GEMINI_API_KEY__': JSON.stringify(mergedEnv.VITE_GEMINI_API_KEY || mergedEnv.API_KEY || ""),

      // Map variations of process.env for legacy support in components/services
      'process.env.API_KEY': JSON.stringify(mergedEnv.VITE_GEMINI_API_KEY || mergedEnv.API_KEY || ""),
      'process.env.VITE_GEMINI_API_KEY': JSON.stringify(mergedEnv.VITE_GEMINI_API_KEY || mergedEnv.API_KEY || ""),
      'process.env.VITE_SUPABASE_URL': JSON.stringify(mergedEnv.VITE_SUPABASE_URL || mergedEnv.SUPABASE_URL || ""),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(mergedEnv.VITE_SUPABASE_ANON_KEY || mergedEnv.SUPABASE_ANON_KEY || ""),
      'process.env.SUPABASE_URL': JSON.stringify(mergedEnv.VITE_SUPABASE_URL || mergedEnv.SUPABASE_URL || ""),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(mergedEnv.VITE_SUPABASE_ANON_KEY || mergedEnv.SUPABASE_ANON_KEY || ""),
    }
  };
});
