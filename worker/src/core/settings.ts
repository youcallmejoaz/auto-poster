import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Every setting the dashboard can edit. The worker merges these (from the DB) over env vars,
 * so changes in the UI apply on the next stage run without redeploying.
 * Bootstrap values (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SETTINGS_ENCRYPTION_KEY) stay env-only.
 */
export interface SettingDef {
  key: string;
  label: string;
  group: "App" | "AI" | "Voice" | "Research" | "Instagram" | "TikTok" | "Publishing" | "Ops" | "Automation";
  secret?: boolean;
  help?: string;
  type?: "text" | "textarea" | "number" | "bool";
  /** Written by the pipeline (e.g. refreshed tokens, expiry times); not shown as an editable field. */
  internal?: boolean;
  placeholder?: string;
}

export const SETTINGS: SettingDef[] = [
  { key: "APP_NAME", label: "App name", group: "App", placeholder: "StudyApp" },
  { key: "APP_DESCRIPTION", label: "What the app does", group: "App", type: "textarea", help: "One or two sentences. Scripts only claim what's written here." },
  { key: "APP_LANDING_URL", label: "Download link", group: "App", help: "Smart link that routes to App Store / Play (Branch, AppsFlyer OneLink, or your own)." },
  { key: "DASHBOARD_URL", label: "Dashboard public URL", group: "App", placeholder: "https://studyshorts.yourdomain.com", help: "Put <this URL>/go?p=tiktok in your TikTok bio (and ?p=instagram on IG). It always redirects to the newest video's tracked link and counts clicks." },
  { key: "LEGAL_ENTITY_NAME", label: "Operator name (legal pages)", group: "App", placeholder: "Your name or company", help: "Shown on your public /terms and /privacy pages. Defaults to the app name." },
  { key: "CONTACT_EMAIL", label: "Contact email (legal pages)", group: "App", placeholder: "support@yourapp.com", help: "Where people send privacy or data-deletion requests. Shown publicly on /terms and /privacy." },
  { key: "BRAND_COLORS", label: "Brand colours", group: "App", placeholder: "#0f172a,#4c1d95,#facc15", help: "background, background 2, accent. Leave empty to let each script choose." },
  { key: "NICHE_HASHTAGS", label: "Niche hashtags", group: "Research", placeholder: "studytok,studywithme,studytips" },
  { key: "COMPETITOR_ACCOUNTS", label: "Competitor accounts", group: "Research", placeholder: "handle1,handle2" },
  { key: "APIFY_TOKEN", label: "Apify API token", group: "Research", secret: true, help: "apify.com → Settings → Integrations" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "AI", secret: true, help: "console.anthropic.com → API keys" },
  { key: "LLM_MODEL_BULK", label: "Script model", group: "AI", placeholder: "claude-sonnet-5-5" },
  { key: "LLM_MODEL_JUDGE", label: "Judge / strategy model", group: "AI", placeholder: "claude-opus-5-5" },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API key", group: "Voice", secret: true, help: "Optional. Without it videos have no voiceover or captions." },
  { key: "ELEVENLABS_VOICE_ID", label: "Voice ID", group: "Voice", placeholder: "21m00Tcm4TlvDq8ikWAM" },
  { key: "IG_APP_ID", label: "Instagram app ID", group: "Instagram", help: "Meta developer dashboard → your app → Instagram → API setup with Instagram login. Enables the Connect button and auto-refresh." },
  { key: "IG_APP_SECRET", label: "Instagram app secret", group: "Instagram", secret: true },
  { key: "IG_USER_ID", label: "Instagram account ID", group: "Instagram", help: "Filled in automatically when you use Connect." },
  { key: "IG_ACCESS_TOKEN", label: "Instagram access token", group: "Instagram", secret: true, help: "Filled in by Connect, or paste one. Long-lived tokens are refreshed automatically before their 60 days run out." },
  { key: "META_APP_ID", label: "Facebook app ID (optional)", group: "Instagram", help: "Only if you paste a Facebook Login token (starts with EAA): it gets converted once into a Page token that doesn't expire." },
  { key: "META_APP_SECRET", label: "Facebook app secret (optional)", group: "Instagram", secret: true },
  { key: "IG_TOKEN_EXPIRES_AT", label: "Instagram token expiry", group: "Instagram", internal: true },
  { key: "IG_TOKEN_KIND", label: "Instagram token kind", group: "Instagram", internal: true },
  { key: "TIKTOK_CLIENT_KEY", label: "TikTok client key", group: "TikTok", help: "developers.tiktok.com → your app. Enables the Connect button and auto-refresh." },
  { key: "TIKTOK_CLIENT_SECRET", label: "TikTok client secret", group: "TikTok", secret: true },
  { key: "TIKTOK_ACCESS_TOKEN", label: "TikTok access token", group: "TikTok", secret: true, help: "Filled in by Connect. Expires every 24h and is refreshed automatically." },
  { key: "TIKTOK_REFRESH_TOKEN", label: "TikTok refresh token", group: "TikTok", secret: true, help: "Filled in by Connect (valid 365 days, renewed on each refresh)." },
  { key: "TIKTOK_TOKEN_EXPIRES_AT", label: "TikTok token expiry", group: "TikTok", internal: true },
  { key: "TIKTOK_REFRESH_EXPIRES_AT", label: "TikTok refresh token expiry", group: "TikTok", internal: true },
  { key: "TIKTOK_PRIVACY", label: "TikTok privacy", group: "TikTok", placeholder: "SELF_ONLY", help: "Keep SELF_ONLY until TikTok approves your app audit, then PUBLIC_TO_EVERYONE." },
  { key: "POST_SLOTS_UTC", label: "Posting times (UTC)", group: "Publishing", placeholder: "15:00,20:00" },
  { key: "DAILY_POST_CAP", label: "Max videos per day", group: "Publishing", type: "number", placeholder: "2" },
  { key: "AUTO_APPROVE", label: "Auto-approve videos that pass the quality bar", group: "Publishing", type: "bool" },
  { key: "VIDEOS_PER_RUN", label: "Videos per create run", group: "Ops", type: "number", placeholder: "3" },
  { key: "QUALITY_THRESHOLD", label: "Quality threshold (0-10)", group: "Ops", type: "number", placeholder: "7" },
  { key: "MAX_CRITIQUE_LOOPS", label: "Max revise loops", group: "Ops", type: "number", placeholder: "2" },
  { key: "DAILY_BUDGET_USD", label: "Daily AI budget (USD)", group: "Ops", type: "number", placeholder: "10" },
  { key: "ALERT_WEBHOOK_URL", label: "Alert webhook (Slack/Discord)", group: "Ops", secret: true },
  { key: "GITHUB_REPO", label: "GitHub repo (owner/name)", group: "Automation", help: "Where the pipeline workflow runs. Enables the Run buttons." },
  { key: "GITHUB_TOKEN", label: "GitHub token", group: "Automation", secret: true, help: "Fine-grained token for that repo with Actions: read & write." },
];

export const SETTING_KEYS = new Set(SETTINGS.map((s) => s.key));

function keyBytes(key: string): Buffer {
  // Accept any string; derive a 32-byte key so users can't misconfigure the length.
  return createHash("sha256").update(key).digest();
}

export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string, key: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1") throw new Error("unknown secret format");
  const d = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export interface StoredSetting {
  key: string;
  value: string;
  is_secret: boolean;
  updated_at?: string;
}

/** Decrypts stored settings into a plain env-style record. Unknown keys and undecryptable values are skipped. */
export function settingsToEnv(rows: StoredSetting[], encKey: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!SETTING_KEYS.has(r.key) || r.value === "") continue;
    if (r.is_secret) {
      if (!encKey) continue;
      try {
        out[r.key] = decryptSecret(r.value, encKey);
      } catch {
        // Wrong key: ignore rather than crash every stage; supervisor/UI will show it as unset.
      }
    } else out[r.key] = r.value;
  }
  return out;
}

export const maskSecret = (s: string) => (s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`);

/** Encrypts (when secret) and stores one setting. Used by the token stage and OAuth callbacks. */
export async function storeSetting(repo: { setSetting(s: StoredSetting): Promise<void> }, encKey: string | undefined, key: string, value: string) {
  const def = SETTINGS.find((d) => d.key === key);
  if (!def) throw new Error(`unknown setting ${key}`);
  if (def.secret) {
    if (!encKey) throw new Error("SETTINGS_ENCRYPTION_KEY is required to store tokens");
    await repo.setSetting({ key, value: encryptSecret(value, encKey), is_secret: true });
  } else await repo.setSetting({ key, value, is_secret: false });
}
