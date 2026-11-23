import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig, loadRuntimeConfig, type Config } from "worker/env";
import type { Repo } from "worker/repo";
import { SupabaseRepo } from "worker/supabaseRepo";
import { MemoryRepo } from "worker/memoryRepo";
import { SESSION_COOKIE, isDemo, verifySession } from "./session";
import { seedDemo } from "./demo";

const g = globalThis as unknown as { __repo?: Repo };

/** Supabase in production; a seeded in-memory repo in DEMO_MODE so the UI can be explored without setup. */
export function getRepo(): Repo {
  if (g.__repo) return g.__repo;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    g.__repo = new SupabaseRepo(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } else if (isDemo()) {
    const m = new MemoryRepo();
    m.urlFor = (p) => `/demo/${p.split("/").pop()}`;
    seedDemo(m);
    g.__repo = m;
  } else {
    throw new SetupError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. Add them to the dashboard's environment (or set DEMO_MODE=true to explore with sample data).");
  }
  return g.__repo;
}

export class SetupError extends Error {}

export async function getConfig(): Promise<Config> {
  try {
    return await loadRuntimeConfig(getRepo());
  } catch (e) {
    if (e instanceof SetupError) throw e;
    // A bad value saved outside the UI shouldn't lock you out of the Settings page to fix it.
    console.error("Stored settings are invalid; falling back to environment:", (e as Error).message);
    return loadConfig();
  }
}

/** Server actions are public POST endpoints; check the session in every one. */
export async function requireAuth() {
  if (isDemo()) return;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySession(token))) redirect("/login");
}

export const encKey = () => process.env.SETTINGS_ENCRYPTION_KEY;
