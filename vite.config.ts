
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

// Manual .env parser fallback
function getManualEnv(cwd: string) {
  const envPath = path.resolve(cwd, '.env');
  const env: Record<string, string> = {};

  console.error("--- VERCEL BUILD DIAGNOSTICS ---");
  console.error("CWD:", cwd);
  console.error("Target .env path:", envPath);

  try {
    const files = fs.readdirSync(cwd);
    console.error("Files in root:", files.join(', '));
  } catch (e) {
    console.error("Failed to list files:", e);
  }

  if (fs.existsSync(envPath)) {
    console.error(".env file EXISTS according to fs.existsSync");
    try {
      const stats = fs.statSync(envPath);
      console.error(".env file size:", stats.size, "bytes");
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
      console.error("Manual .env Load: SUCCESS. Found keys:", Object.keys(env).join(', '));
    } catch (e) {
      console.error("Manual .env Load: FAILED to read", e);
    }
  } else {
    console.error(".env file DOES NOT EXIST at " + envPath);
  }
  console.error("--------------------------------");
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
