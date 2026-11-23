import { describe, expect, it } from "vitest";
import { VideoScript } from "renderer/schema";
import { decryptSecret, encryptSecret, settingsToEnv } from "../src/core/settings";
import { loadRuntimeConfig } from "../src/core/env";
import { MemoryRepo } from "../src/core/memoryRepo";
import { FakeLlm } from "../src/core/llm";
import type { Ctx } from "../src/core/context";
import { decorate, parseBrandColors, resolveAssets } from "../src/creator/create";
import { DbAttribution } from "../src/analytics/analytics";
import { loadConfig } from "../src/core/env";
import listicle from "../../renderer/fixtures/listicle.json";

describe("settings", () => {
  it("encrypts secrets with AES-GCM and rejects the wrong key", () => {
    const blob = encryptSecret("sk-ant-123", "k1");
    expect(blob).not.toContain("sk-ant");
    expect(decryptSecret(blob, "k1")).toBe("sk-ant-123");
    expect(() => decryptSecret(blob, "k2")).toThrow();
  });
  it("merges DB settings over env, skipping unknown keys and undecryptable secrets", async () => {
    const repo = new MemoryRepo();
    await repo.setSetting({ key: "APP_NAME", value: "FlashGenius", is_secret: false });
    await repo.setSetting({ key: "ANTHROPIC_API_KEY", value: encryptSecret("sk-real", "enc"), is_secret: true });
    await repo.setSetting({ key: "SUPABASE_URL", value: "https://evil", is_secret: false }); // bootstrap: never from DB
    const cfg = await loadRuntimeConfig(repo, { APP_NAME: "Old", SETTINGS_ENCRYPTION_KEY: "enc", SUPABASE_URL: "https://real" } as any);
    expect(cfg.APP_NAME).toBe("FlashGenius");
    expect(cfg.ANTHROPIC_API_KEY).toBe("sk-real");
    expect(cfg.SUPABASE_URL).toBe("https://real");
    expect(settingsToEnv(await repo.getSettings(), "wrong").ANTHROPIC_API_KEY).toBeUndefined();
  });
});

function ctxWith(repo: MemoryRepo, env: Record<string, string> = {}): Ctx {
  return { cfg: loadConfig(env as any), repo, llm: new FakeLlm(() => ({})), dryRun: true, cost: { usd: 0 }, log: () => {} };
}
const base = VideoScript.parse(listicle);

describe("creator media + brand", () => {
  it("parses brand colours", () => {
    expect(parseBrandColors("#000, #111,#fc0")).toEqual({ bg: "#000", bg2: "#111", accent: "#fc0" });
    expect(parseBrandColors("red,blue")).toBeNull();
  });
  it("falls back from appDemo to studyHack without a screen recording", async () => {
    const s = await decorate(ctxWith(new MemoryRepo()), { ...base, template: "appDemo" }, "seed");
    expect(s.template).toBe("studyHack");
    expect(s.appMedia).toBeUndefined();
  });
  it("attaches app demo + b-roll as asset refs, applies brand colours, and resolves refs only at render time", async () => {
    const repo = new MemoryRepo();
    repo.urlFor = (p) => `https://signed/${p}`;
    await repo.insertAsset({ kind: "app_demo", label: "demo", storage_path: "app/demo.mp4", content_type: "video/mp4" });
    await repo.insertAsset({ kind: "broll", label: "desk", storage_path: "broll/desk.mp4", content_type: "video/mp4" });
    const ctx = ctxWith(repo, { BRAND_COLORS: "#101010,#202020,#ff0066" });
    const s = await decorate(ctx, base, "seed");
    expect(s.appMedia).toBe("asset:app/demo.mp4");
    expect(s.backgroundVideo).toBe("asset:broll/desk.mp4");
    expect(s.theme.accent).toBe("#ff0066");
    const r = await resolveAssets(ctx, s);
    expect(r.appMedia).toBe("https://signed/app/demo.mp4");
    const demo = await decorate(ctx, { ...base, template: "appDemo" }, "seed");
    expect(demo.template).toBe("appDemo");
    expect(demo.backgroundVideo).toBeUndefined(); // the phone is the focus
  });
});

describe("db attribution", () => {
  it("uses imported installs and falls back to /go click counts", async () => {
    const repo = new MemoryRepo();
    await repo.upsertAttribution([{ code: "abc", clicks: 0, installs: 7 }]);
    await repo.logClick("abc", "tiktok");
    await repo.logClick("xyz", "tiktok");
    const a = await DbAttribution.load(repo);
    expect(a.lookup("https://x/?utm_content=abc")).toEqual({ clicks: 1, installs: 7 });
    expect(a.lookup("https://x/?utm_content=xyz")).toEqual({ clicks: 1, installs: 0 });
    expect(a.lookup("https://x/?utm_content=none")).toBeNull();
  });
});
