import { describe, expect, it } from "vitest";
import { loadConfig, loadRuntimeConfig, type Config } from "../src/core/env";
import { MemoryRepo } from "../src/core/memoryRepo";
import { FakeLlm } from "../src/core/llm";
import type { Ctx } from "../src/core/context";
import {
  exchangeInstagramCode,
  exchangeTikTokCode,
  igGraphHost,
  instagramAuthorizeUrl,
  refreshInstagram,
  refreshTikTok,
  repoSink,
  runTokens,
  tiktokAuthorizeUrl,
  tokenWarnings,
  type Fetch,
} from "../src/publisher/tokens";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const ENC = "enc-key";

type Call = { url: string; method: string; body: string };
/** Fake fetch: routes by URL substring, records calls. */
function fakeFetch(routes: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const f = (async (input: any, init: any = {}) => {
    const call = { url: String(input), method: init.method ?? "GET", body: init.body ? String(init.body) : "" };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${call.url}`);
    const r = routes[key](call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as Fetch;
  return { f, calls };
}

function setup(env: Record<string, string>) {
  const repo = new MemoryRepo();
  const cfg = loadConfig({ SETTINGS_ENCRYPTION_KEY: ENC, ...env } as any);
  return { repo, cfg, sink: repoSink(repo, ENC, cfg) };
}
const reload = (repo: MemoryRepo) => loadRuntimeConfig(repo, { SETTINGS_ENCRYPTION_KEY: ENC } as any);
const tiktokApp = { TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs" };

describe("TikTok", () => {
  it("builds the authorize URL with publish scopes", () => {
    const { cfg } = setup(tiktokApp);
    const u = new URL(tiktokAuthorizeUrl(cfg, "https://dash/api/oauth/tiktok/callback", "st"));
    expect(u.searchParams.get("client_key")).toBe("ck");
    expect(u.searchParams.get("scope")).toContain("video.publish");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("exchanges the OAuth code and stores encrypted tokens with expiry", async () => {
    const { repo, cfg, sink } = setup(tiktokApp);
    const { f, calls } = fakeFetch({ "/v2/oauth/token/": () => ({ body: { access_token: "act.1", expires_in: 86400, refresh_token: "rft.1", refresh_expires_in: 31536000, scope: "video.publish" } }) });
    await exchangeTikTokCode(cfg, "CODE", "https://dash/cb", sink, f, NOW);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("CODE");
    expect(body.get("client_secret")).toBe("cs");
    const stored = await repo.getSettings();
    expect(stored.find((s) => s.key === "TIKTOK_REFRESH_TOKEN")!.value).not.toContain("rft.1"); // encrypted at rest
    const c = await reload(repo);
    expect(c.TIKTOK_ACCESS_TOKEN).toBe("act.1");
    expect(c.TIKTOK_REFRESH_TOKEN).toBe("rft.1");
    expect(c.TIKTOK_TOKEN_EXPIRES_AT).toBe("2026-11-24T12:00:00.000Z");
  });

  it("skips refresh while the token has > 12h left, refreshes inside the window, keeps the rotated refresh token", async () => {
    const { repo, cfg, sink } = setup({ ...tiktokApp, TIKTOK_ACCESS_TOKEN: "old", TIKTOK_REFRESH_TOKEN: "rft.1", TIKTOK_TOKEN_EXPIRES_AT: "2026-11-24T06:00:00Z" });
    const { f, calls } = fakeFetch({ "/v2/oauth/token/": () => ({ body: { access_token: "new", expires_in: 86400, refresh_token: "rft.2", refresh_expires_in: 31536000 } }) });
    expect((await refreshTikTok(cfg, sink, { f, now: NOW })).status).toBe("skipped"); // 18h left
    expect(calls).toHaveLength(0);
    const r = await refreshTikTok(cfg, sink, { f, now: NOW + 7 * 3600e3 }); // 11h left
    expect(r.status).toBe("refreshed");
    expect(new URLSearchParams(calls[0].body).get("refresh_token")).toBe("rft.1");
    expect(cfg.TIKTOK_ACCESS_TOKEN).toBe("new");
    expect((await reload(repo)).TIKTOK_REFRESH_TOKEN).toBe("rft.2");
  });

  it("surfaces TikTok OAuth errors", async () => {
    const { cfg, sink } = setup({ ...tiktokApp, TIKTOK_REFRESH_TOKEN: "bad" });
    const { f } = fakeFetch({ "/v2/oauth/token/": () => ({ status: 400, body: { error: "invalid_grant", error_description: "Refresh token is invalid or expired." } }) });
    await expect(refreshTikTok(cfg, sink, { f, now: NOW })).rejects.toThrow(/invalid_grant: Refresh token is invalid/);
  });

  it("reports not_configured for manually pasted tokens", async () => {
    const { cfg, sink } = setup({ TIKTOK_ACCESS_TOKEN: "pasted" });
    expect((await refreshTikTok(cfg, sink, { now: NOW })).status).toBe("not_configured");
  });
});

describe("Instagram", () => {
  const igApp = { IG_APP_ID: "app", IG_APP_SECRET: "sec" };

  it("Connect: code -> short token -> 60-day token -> account id", async () => {
    const { repo, cfg, sink } = setup(igApp);
    expect(new URL(instagramAuthorizeUrl(cfg, "https://dash/cb", "s")).searchParams.get("scope")).toContain("instagram_business_content_publish");
    const { f, calls } = fakeFetch({
      "api.instagram.com/oauth/access_token": () => ({ body: { data: [{ access_token: "IGshort", user_id: "123" }] } }),
      "graph.instagram.com/access_token": () => ({ body: { access_token: "IGAAlong", expires_in: 5184000 } }),
      "/me?": () => ({ body: { user_id: "17841400000", username: "studyapp" } }),
    });
    expect(await exchangeInstagramCode(cfg, "CODE#_", "https://dash/cb", sink, f, NOW)).toBe("Connected Instagram @studyapp");
    expect(new URLSearchParams(calls[0].body).get("code")).toBe("CODE"); // trailing #_ stripped
    const c = await reload(repo);
    expect(c.IG_ACCESS_TOKEN).toBe("IGAAlong");
    expect(c.IG_USER_ID).toBe("17841400000");
    expect(c.IG_TOKEN_KIND).toBe("instagram");
    expect(c.IG_TOKEN_EXPIRES_AT).toBe("2027-01-22T12:00:00.000Z");
  });

  it("refreshes Instagram Login tokens inside 30 days of expiry (and when expiry is unknown)", async () => {
    const { f, calls } = fakeFetch({ "refresh_access_token": () => ({ body: { access_token: "IGAAnew", expires_in: 5184000 } }) });
    const far = setup({ IG_ACCESS_TOKEN: "IGAAold", IG_TOKEN_EXPIRES_AT: "2027-01-10T00:00:00Z" });
    expect((await refreshInstagram(far.cfg, far.sink, { f, now: NOW })).status).toBe("skipped");
    const near = setup({ IG_ACCESS_TOKEN: "IGAAold", IG_TOKEN_EXPIRES_AT: "2026-12-10T00:00:00Z" });
    expect((await refreshInstagram(near.cfg, near.sink, { f, now: NOW })).status).toBe("refreshed");
    expect(calls[0].url).toContain("grant_type=ig_refresh_token");
    expect(near.cfg.IG_ACCESS_TOKEN).toBe("IGAAnew");
    const unknown = setup({ IG_ACCESS_TOKEN: "IGAAold" });
    expect((await refreshInstagram(unknown.cfg, unknown.sink, { f, now: NOW })).status).toBe("refreshed");
  });

  it("converts a Facebook user token into a non-expiring Page token for the linked IG account", async () => {
    const { repo, cfg, sink } = setup({ IG_ACCESS_TOKEN: "EAAuser", IG_USER_ID: "1784", META_APP_ID: "m", META_APP_SECRET: "ms" });
    const { f } = fakeFetch({
      "fb_exchange_token": () => ({ body: { access_token: "EAAlonguser", expires_in: 5184000 } }),
      "/me/accounts": () => ({ body: { data: [{ name: "Other", access_token: "EAApage0" }, { name: "StudyApp", access_token: "EAApage1", instagram_business_account: { id: "1784" } }] } }),
    });
    const r = await refreshInstagram(cfg, sink, { f, now: NOW });
    expect(r.status).toBe("converted");
    const c = await reload(repo);
    expect(c.IG_ACCESS_TOKEN).toBe("EAApage1");
    expect(c.IG_TOKEN_KIND).toBe("facebook_page");
    expect((await refreshInstagram(c, repoSink(repo, ENC, c), { f, now: NOW })).status).toBe("skipped"); // never expires
  });

  it("picks the Graph host from the token type", () => {
    expect(igGraphHost("IGAAxyz")).toBe("https://graph.instagram.com");
    expect(igGraphHost("EAAxyz")).toBe("https://graph.facebook.com");
    expect(igGraphHost("anything", "facebook_page")).toBe("https://graph.facebook.com");
  });
});

describe("warnings + stage", () => {
  it("warns about pasted TikTok tokens, expiring refresh tokens and stale IG tokens", () => {
    const cfg = loadConfig({ TIKTOK_ACCESS_TOKEN: "a", IG_ACCESS_TOKEN: "IGAA", IG_TOKEN_EXPIRES_AT: "2026-11-25T00:00:00Z" } as any) as Config;
    const w = tokenWarnings(cfg, NOW).map((x) => x.message).join("\n");
    expect(w).toMatch(/pasted manually/);
    expect(w).toMatch(/Instagram token expires in 2 days/);
    const cfg2 = loadConfig({ TIKTOK_ACCESS_TOKEN: "a", TIKTOK_REFRESH_TOKEN: "r", TIKTOK_REFRESH_EXPIRES_AT: "2026-11-25T00:00:00Z" } as any);
    expect(tokenWarnings(cfg2, NOW)[0]).toMatchObject({ severity: "critical", message: expect.stringMatching(/refresh token expires in 2 days/) });
    expect(tokenWarnings(loadConfig({} as any), NOW)).toEqual([]);
  });

  it("the tokens stage refreshes both platforms and records a failed run when one fails", async () => {
    const repo = new MemoryRepo();
    const cfg = loadConfig({ SETTINGS_ENCRYPTION_KEY: ENC, ...tiktokApp, TIKTOK_ACCESS_TOKEN: "a", TIKTOK_REFRESH_TOKEN: "r", IG_ACCESS_TOKEN: "IGAAold" } as any);
    const ctx: Ctx = { cfg, repo, llm: new FakeLlm(() => ({})), dryRun: false, cost: { usd: 0 }, log: () => {} };
    const { f } = fakeFetch({
      "/v2/oauth/token/": () => ({ body: { access_token: "t2", expires_in: 86400 } }),
      "refresh_access_token": () => ({ status: 400, body: { error: { message: "Error validating access token" } } }),
    });
    await expect(runTokens(ctx, { f })).rejects.toThrow(/Instagram refresh failed: 400 Error validating access token/);
    expect(cfg.TIKTOK_ACCESS_TOKEN).toBe("t2"); // TikTok still refreshed
    expect(repo.runs[0]).toMatchObject({ stage: "tokens", status: "error" });
  });
});
