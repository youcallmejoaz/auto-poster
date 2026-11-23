// Edge-compatible (Web Crypto) session tokens: "<expiryMs>.<hmac>". Single admin login.
export const SESSION_COOKIE = "ss_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

function secret(): string {
  // SESSION_SECRET is preferred; falls back to the password so changing it logs everyone out.
  return process.env.SESSION_SECRET || `pw:${process.env.DASHBOARD_PASSWORD ?? ""}`;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function createSession(): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  return `${exp}.${await hmac(exp)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const isDemo = () => process.env.DEMO_MODE === "true" && !process.env.SUPABASE_URL;
