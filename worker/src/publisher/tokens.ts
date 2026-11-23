import type { Config } from "../core/env";
import type { Repo } from "../core/repo";
import { storeSetting } from "../core/settings";
import { runStage, type Ctx } from "../core/context";

/**
 * Token lifecycle for TikTok and Instagram.
 *
 * TikTok: access tokens last 24h, refresh tokens 365 days (renewed on every refresh).
 * Instagram Login: long-lived tokens last 60 days and can be refreshed once they're >24h old.
 * Facebook Login: a long-lived user token is converted once into a Page token, which doesn't expire.
 */

export type Fetch = typeof fetch;

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_SCOPES = "user.info.basic,video.publish,video.list";
export const IG_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights";

/** TikTok refreshes when < 12h left (the stage runs every 6h, so there are always two attempts). */
const TIKTOK_REFRESH_WINDOW_MS = 12 * 3600e3;
/** Instagram refreshes when < 30 days left (≈ every couple of weeks of a 60-day token). */
const IG_REFRESH_WINDOW_MS = 30 * 86400e3;

export type IgTokenKind = "instagram" | "facebook_user" | "facebook_page";
export const igTokenKind = (token: string, stored?: string): IgTokenKind =>
  stored === "facebook_page" ? "facebook_page" : token.startsWith("IG") ? "instagram" : token.startsWith("EAA") ? "facebook_user" : "instagram";

/** Graph host for publishing: Instagram Login tokens use graph.instagram.com, Facebook tokens graph.facebook.com. */
export const igGraphHost = (token: string, kind?: string) => (igTokenKind(token, kind) === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com");

const iso = (msFromNow: number, now: number) => new Date(now + msFromNow).toISOString();

async function json(res: Response) {
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok || body.error) {
    const e = body.error;
    const msg = typeof e === "object" ? e.message ?? JSON.stringify(e) : [e, body.error_description, body.error_message].filter(Boolean).join(": ");
    throw new Error(`${res.status} ${msg || text.slice(0, 300)}`);
  }
  return body;
}

/** Persists token fields and mirrors them onto the in-memory config. */
export interface TokenSink {
  save(values: Partial<Record<keyof Config, string>>): Promise<void>;
}

export function repoSink(repo: Repo, encKey: string | undefined, cfg?: Config): TokenSink {
  return {
    async save(values) {
      for (const [k, v] of Object.entries(values)) {
        if (v == null) continue;
        await storeSetting(repo, encKey, k, v);
        if (cfg) (cfg as Record<string, unknown>)[k] = v;
      }
    },
  };
}

// ---------------------------------------------------------------- TikTok

export function tiktokAuthorizeUrl(cfg: Config, redirectUri: string, state: string) {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", cfg.TIKTOK_CLIENT_KEY!);
  u.searchParams.set("scope", TIKTOK_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tiktokToken(cfg: Config, params: Record<string, string>, f: Fetch, now: number, sink: TokenSink) {
  if (!cfg.TIKTOK_CLIENT_KEY || !cfg.TIKTOK_CLIENT_SECRET) throw new Error("TikTok client key/secret not set");
  const body = new URLSearchParams({ client_key: cfg.TIKTOK_CLIENT_KEY, client_secret: cfg.TIKTOK_CLIENT_SECRET, ...params });
  const r = await json(await f(TIKTOK_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body }));
  if (!r.access_token) throw new Error("TikTok returned no access_token");
  await sink.save({
    TIKTOK_ACCESS_TOKEN: r.access_token,
    TIKTOK_TOKEN_EXPIRES_AT: iso(Number(r.expires_in ?? 86400) * 1000, now),
    // TikTok may rotate the refresh token; always keep the newest one.
    TIKTOK_REFRESH_TOKEN: r.refresh_token ?? cfg.TIKTOK_REFRESH_TOKEN,
    TIKTOK_REFRESH_EXPIRES_AT: r.refresh_expires_in ? iso(Number(r.refresh_expires_in) * 1000, now) : cfg.TIKTOK_REFRESH_EXPIRES_AT,
  });
  return r as { access_token: string; open_id?: string; scope?: string };
}

/** OAuth callback: authorization code -> access + refresh tokens. */
export async function exchangeTikTokCode(cfg: Config, code: string, redirectUri: string, sink: TokenSink, f: Fetch = fetch, now = Date.now()) {
  const r = await tiktokToken(cfg, { code, grant_type: "authorization_code", redirect_uri: redirectUri }, f, now, sink);
  return `Connected TikTok (scopes: ${r.scope ?? TIKTOK_SCOPES})`;
}

export type RefreshResult = { platform: "tiktok" | "instagram"; status: "refreshed" | "skipped" | "not_configured" | "converted"; detail: string };

export async function refreshTikTok(cfg: Config, sink: TokenSink, opts: { force?: boolean; f?: Fetch; now?: number } = {}): Promise<RefreshResult> {
  const f = opts.f ?? fetch;
  const now = opts.now ?? Date.now();
  if (!cfg.TIKTOK_REFRESH_TOKEN || !cfg.TIKTOK_CLIENT_KEY || !cfg.TIKTOK_CLIENT_SECRET) {
    const hasApp = !!(cfg.TIKTOK_CLIENT_KEY && cfg.TIKTOK_CLIENT_SECRET);
    const detail = !cfg.TIKTOK_ACCESS_TOKEN ? "not connected" : hasApp ? "no refresh token yet; click Connect TikTok once to enable auto-refresh" : "access token set manually; add the client key/secret and use Connect to enable auto-refresh";
    return { platform: "tiktok", status: "not_configured", detail };
  }
  const exp = cfg.TIKTOK_TOKEN_EXPIRES_AT ? Date.parse(cfg.TIKTOK_TOKEN_EXPIRES_AT) : 0;
  if (!opts.force && cfg.TIKTOK_ACCESS_TOKEN && exp - now > TIKTOK_REFRESH_WINDOW_MS) {
    return { platform: "tiktok", status: "skipped", detail: `valid until ${cfg.TIKTOK_TOKEN_EXPIRES_AT}` };
  }
  await tiktokToken(cfg, { grant_type: "refresh_token", refresh_token: cfg.TIKTOK_REFRESH_TOKEN }, f, now, sink);
  return { platform: "tiktok", status: "refreshed", detail: `valid until ${cfg.TIKTOK_TOKEN_EXPIRES_AT}` };
}

// ---------------------------------------------------------------- Instagram

export function instagramAuthorizeUrl(cfg: Config, redirectUri: string, state: string) {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", cfg.IG_APP_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

/** OAuth callback: code -> short-lived token -> 60-day token, plus the professional account id. */
export async function exchangeInstagramCode(cfg: Config, code: string, redirectUri: string, sink: TokenSink, f: Fetch = fetch, now = Date.now()) {
  if (!cfg.IG_APP_ID || !cfg.IG_APP_SECRET) throw new Error("Instagram app ID/secret not set");
  const short = await json(
    await f("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.IG_APP_ID, client_secret: cfg.IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }),
    }),
  );
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error("Instagram returned no access_token");
  const long = await json(await f(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: cfg.IG_APP_SECRET, access_token: shortToken })}`));
  const me = await json(await f(`https://graph.instagram.com/${cfg.META_GRAPH_VERSION}/me?${new URLSearchParams({ fields: "user_id,username", access_token: long.access_token })}`));
  await sink.save({
    IG_ACCESS_TOKEN: long.access_token,
    IG_TOKEN_EXPIRES_AT: iso(Number(long.expires_in ?? 5184000) * 1000, now),
    IG_TOKEN_KIND: "instagram",
    IG_USER_ID: String(me.user_id ?? me.id),
  });
  return `Connected Instagram @${me.username}`;
}

export async function refreshInstagram(cfg: Config, sink: TokenSink, opts: { force?: boolean; f?: Fetch; now?: number } = {}): Promise<RefreshResult> {
  const f = opts.f ?? fetch;
  const now = opts.now ?? Date.now();
  const token = cfg.IG_ACCESS_TOKEN;
  if (!token) return { platform: "instagram", status: "not_configured", detail: "not connected" };
  const kind = igTokenKind(token, cfg.IG_TOKEN_KIND);
  const v = cfg.META_GRAPH_VERSION;

  if (kind === "facebook_page") return { platform: "instagram", status: "skipped", detail: "Page token (does not expire)" };

  if (kind === "facebook_user") {
    if (!cfg.META_APP_ID || !cfg.META_APP_SECRET) return { platform: "instagram", status: "not_configured", detail: "Facebook user token expires in ≤60 days; add Facebook app ID/secret to convert it into a non-expiring Page token" };
    // User token -> long-lived user token -> Page token for the Page linked to this IG account.
    const ll = await json(await f(`https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.META_APP_ID, client_secret: cfg.META_APP_SECRET, fb_exchange_token: token })}`));
    const pages = await json(await f(`https://graph.facebook.com/${v}/me/accounts?${new URLSearchParams({ fields: "name,access_token,instagram_business_account", access_token: ll.access_token })}`));
    const page = (pages.data ?? []).find((p: any) => p.instagram_business_account?.id && (!cfg.IG_USER_ID || p.instagram_business_account.id === cfg.IG_USER_ID));
    if (!page) throw new Error("No Facebook Page with a linked Instagram professional account found for this token");
    await sink.save({ IG_ACCESS_TOKEN: page.access_token, IG_TOKEN_KIND: "facebook_page", IG_USER_ID: page.instagram_business_account.id, IG_TOKEN_EXPIRES_AT: "" });
    return { platform: "instagram", status: "converted", detail: `converted to non-expiring Page token for "${page.name}"` };
  }

  const exp = cfg.IG_TOKEN_EXPIRES_AT ? Date.parse(cfg.IG_TOKEN_EXPIRES_AT) : 0;
  if (!opts.force && exp && exp - now > IG_REFRESH_WINDOW_MS) return { platform: "instagram", status: "skipped", detail: `valid until ${cfg.IG_TOKEN_EXPIRES_AT}` };
  const r = await json(await f(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`));
  await sink.save({ IG_ACCESS_TOKEN: r.access_token, IG_TOKEN_EXPIRES_AT: iso(Number(r.expires_in ?? 5184000) * 1000, now), IG_TOKEN_KIND: "instagram" });
  return { platform: "instagram", status: "refreshed", detail: `valid until ${cfg.IG_TOKEN_EXPIRES_AT}` };
}

// ---------------------------------------------------------------- health + stage

export interface TokenWarning {
  severity: "warn" | "critical";
  message: string;
}

/** Pure check used by the supervisor and dashboard. */
export function tokenWarnings(cfg: Config, now = Date.now()): TokenWarning[] {
  const out: TokenWarning[] = [];
  const days = (iso?: string) => (iso ? (Date.parse(iso) - now) / 86400e3 : null);
  if (cfg.TIKTOK_ACCESS_TOKEN) {
    const left = days(cfg.TIKTOK_TOKEN_EXPIRES_AT);
    if (!cfg.TIKTOK_REFRESH_TOKEN) out.push({ severity: "warn", message: "TikTok token was pasted manually and expires within 24h. Use Connect TikTok so it refreshes itself." });
    else if (left != null && left < 0) out.push({ severity: "critical", message: "TikTok access token has expired and refresh hasn't succeeded. Check the tokens stage, or reconnect TikTok." });
    const rleft = days(cfg.TIKTOK_REFRESH_EXPIRES_AT);
    if (rleft != null && rleft < 14) out.push({ severity: rleft < 3 ? "critical" : "warn", message: `TikTok refresh token expires in ${Math.max(0, Math.round(rleft))} days. Reconnect TikTok.` });
  }
  if (cfg.IG_ACCESS_TOKEN) {
    const kind = igTokenKind(cfg.IG_ACCESS_TOKEN, cfg.IG_TOKEN_KIND);
    const left = days(cfg.IG_TOKEN_EXPIRES_AT || undefined);
    if (kind === "facebook_user" && (!cfg.META_APP_ID || !cfg.META_APP_SECRET)) out.push({ severity: "warn", message: "Instagram uses a Facebook user token that expires. Add the Facebook app ID/secret so it's converted into a non-expiring Page token." });
    if (left != null && left < 7) out.push({ severity: left < 1 ? "critical" : "warn", message: `Instagram token expires in ${Math.max(0, Math.round(left))} days and auto-refresh hasn't renewed it.` });
  }
  return out;
}

/** Scheduled stage: refreshes whatever needs it. Fails (and alerts) if any refresh fails. */
export async function runTokens(ctx: Ctx, opts: { force?: boolean; f?: Fetch } = {}) {
  return runStage(ctx, "tokens", async () => {
    const sink = repoSink(ctx.repo, ctx.cfg.SETTINGS_ENCRYPTION_KEY, ctx.cfg);
    const results: RefreshResult[] = [];
    const errors: string[] = [];
    for (const fn of [refreshTikTok, refreshInstagram]) {
      try {
        if (ctx.dryRun) continue;
        results.push(await fn(ctx.cfg, sink, opts));
      } catch (e) {
        errors.push(`${fn === refreshTikTok ? "TikTok" : "Instagram"} refresh failed: ${(e as Error).message}`);
      }
    }
    for (const r of results) ctx.log(`[tokens] ${r.platform}: ${r.status} (${r.detail})`);
    if (errors.length) throw new Error(errors.join("; "));
    return { items: results.filter((r) => r.status === "refreshed" || r.status === "converted").length, results };
  });
}

/**
 * Safety net before publish/analytics: if TikTok's token is already expired (e.g. the tokens stage
 * was down), refresh it now instead of failing the run.
 */
export async function ensureFreshTikTok(ctx: Ctx, f: Fetch = fetch) {
  const c = ctx.cfg;
  if (ctx.dryRun || !c.TIKTOK_REFRESH_TOKEN || !c.TIKTOK_CLIENT_KEY) return;
  const exp = c.TIKTOK_TOKEN_EXPIRES_AT ? Date.parse(c.TIKTOK_TOKEN_EXPIRES_AT) : 0;
  if (exp - Date.now() > 30 * 60e3) return;
  try {
    await refreshTikTok(c, repoSink(ctx.repo, c.SETTINGS_ENCRYPTION_KEY, c), { force: true, f });
    ctx.log("[tokens] refreshed expiring TikTok token before use");
  } catch (e) {
    ctx.log(`[tokens] emergency TikTok refresh failed: ${(e as Error).message}`);
  }
}
