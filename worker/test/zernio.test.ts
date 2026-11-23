import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/env";
import { ZernioClient, ZernioPublisher, pickAccount, zernioAccountIssues, zernioPublishers, type ZernioAccount } from "../src/publisher/zernio";

type Call = { method: string; url: string; headers: Record<string, string>; body: any };

/** Simulated Zernio API, shaped after zernio.com/openapi.yaml. */
function fakeZernio(opts: { accounts?: ZernioAccount[]; finalStatus?: string[]; conflict?: boolean; metrics?: any[] } = {}) {
  const calls: Call[] = [];
  let polls = 0;
  const statuses = opts.finalStatus ?? ["publishing", "published"];
  const f = (async (input: any, init: any = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method ?? "GET", url, headers, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (url.startsWith("https://upload.example/")) return new Response(null, { status: 200 });
    if (headers.authorization !== "Bearer sk_test") return json(401, { error: "Unauthorized" });
    if (url.endsWith("/accounts")) return json(200, { accounts: opts.accounts ?? [], hasAnalyticsAccess: true });
    if (url.endsWith("/media/presign")) return json(200, { uploadUrl: "https://upload.example/abc", publicUrl: "https://media.zernio.com/abc.mp4", expiresIn: 3600 });
    if (url.endsWith("/posts") && init.method === "POST") {
      if (opts.conflict) return json(409, { error: "Duplicate content", existingPostId: "p_existing" });
      return json(201, { post: { _id: "p_new", status: "scheduled", platforms: body.platforms.map((p: any) => ({ ...p, status: "pending" })) } });
    }
    const m = url.match(/\/posts\/([^/?]+)$/);
    if (m) {
      const s = statuses[Math.min(polls++, statuses.length - 1)];
      const platform = calls.find((c) => c.url.endsWith("/posts") && c.method === "POST")?.body.platforms[0].platform ?? "tiktok";
      return json(200, { post: { _id: m[1], status: s, platforms: [{ platform, accountId: "acc", status: s, errorMessage: s === "failed" ? "Video too short" : undefined, errorCategory: s === "failed" ? "user_content" : undefined }] } });
    }
    if (url.includes("/metrics/posts")) return json(200, { data: opts.metrics ?? [], pagination: { nextCursor: null, hasMore: false } });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { f, calls };
}

const tmpVideo = () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "z-")), "vid-123.mp4");
  fs.writeFileSync(p, "fake-mp4-bytes");
  return p;
};
const tt: ZernioAccount = { _id: "acc_tt", platform: "tiktok", username: "studyapp", isActive: true };
const ig: ZernioAccount = { _id: "acc_ig", platform: "instagram", username: "studyapp.ig", isActive: true };

describe("Zernio client", () => {
  it("uploads via presign + PUT once per file, then reuses the public URL", async () => {
    const { f, calls } = fakeZernio();
    const c = new ZernioClient("sk_test", "https://zernio.com/api/v1", f, 0);
    const file = tmpVideo();
    expect(await c.uploadVideo(file)).toBe("https://media.zernio.com/abc.mp4");
    await c.uploadVideo(file);
    expect(calls.filter((x) => x.url.endsWith("/media/presign"))).toHaveLength(1);
    expect(calls[0].body).toEqual({ filename: "vid-123.mp4", contentType: "video/mp4", size: 14 });
    expect(calls[1]).toMatchObject({ method: "PUT", url: "https://upload.example/abc", headers: { "content-type": "video/mp4" } });
  });

  it("surfaces API errors with status and message", async () => {
    const { f } = fakeZernio();
    await expect(new ZernioClient("wrong", undefined, f).listAccounts()).rejects.toThrow(/GET \/accounts → 401: Unauthorized/);
  });
});

describe("Zernio publisher", () => {
  it("posts a TikTok video with consent, privacy and AI disclosure, waits for publish, returns a zernio id", async () => {
    const { f, calls } = fakeZernio();
    const pub = new ZernioPublisher("tiktok", new ZernioClient("sk_test", undefined, f, 0), tt, { privacy: "PUBLIC_TO_EVERYONE", aiDisclosure: true, waitMs: 5000 });
    const id = await pub.publish({ localFile: tmpVideo(), caption: "3 study hacks #studytok", videoId: "v1" });
    expect(id).toBe("zernio:p_new");
    const create = calls.find((c) => c.url.endsWith("/posts") && c.method === "POST")!;
    expect(create.headers["idempotency-key"]).toBe("studyshorts:v1:tiktok");
    expect(create.body).toMatchObject({
      content: "3 study hacks #studytok",
      mediaItems: [{ type: "video", url: "https://media.zernio.com/abc.mp4" }],
      platforms: [{ platform: "tiktok", accountId: "acc_tt" }],
      externalId: "v1",
      tiktokSettings: { privacyLevel: "PUBLIC_TO_EVERYONE", contentPreviewConfirmed: true, expressConsentGiven: true, videoMadeWithAi: true, allowDuet: true, allowStitch: true },
    });
    expect(Date.parse(create.body.scheduledFor)).toBeGreaterThan(Date.now());
    expect(create.body.publishNow).toBeUndefined();
  });

  it("posts Instagram as a Reel shared to feed with the AI label, no TikTok settings", async () => {
    const { f, calls } = fakeZernio();
    const pub = new ZernioPublisher("instagram", new ZernioClient("sk_test", undefined, f, 0), ig, { privacy: "PUBLIC_TO_EVERYONE", aiDisclosure: false });
    await pub.publish({ localFile: tmpVideo(), caption: "c", videoId: "v2" });
    const body = calls.find((c) => c.url.endsWith("/posts") && c.method === "POST")!.body;
    expect(body.platforms[0]).toEqual({ platform: "instagram", accountId: "acc_ig", platformSpecificData: { shareToFeed: true, isAiGenerated: false } });
    expect(body.tiktokSettings).toBeUndefined();
  });

  it("throws the platform's reason when publishing fails", async () => {
    const { f } = fakeZernio({ finalStatus: ["publishing", "failed"] });
    const pub = new ZernioPublisher("tiktok", new ZernioClient("sk_test", undefined, f, 0), tt, { privacy: "PUBLIC_TO_EVERYONE", aiDisclosure: true });
    await expect(pub.publish({ localFile: tmpVideo(), caption: "c", videoId: "v3" })).rejects.toThrow(/tiktok publish failed: Video too short \(user_content\)/);
  });

  it("treats a 409 duplicate (retry within 24h) as the original post", async () => {
    const { f } = fakeZernio({ conflict: true });
    const pub = new ZernioPublisher("tiktok", new ZernioClient("sk_test", undefined, f, 0), tt, { privacy: "PUBLIC_TO_EVERYONE", aiDisclosure: true });
    expect(await pub.publish({ localFile: tmpVideo(), caption: "c", videoId: "v4" })).toBe("zernio:p_existing");
  });

  it("maps metrics rows for its own platform, converting watch time from ms to seconds", async () => {
    const { f, calls } = fakeZernio({
      metrics: [
        { postId: "p1", platform: "tiktok", metrics: { views: 1200, likes: 90, comments: 4, shares: 7, saves: 11, averageWatchTime: 6400 } },
        { postId: "p1", platform: "instagram", metrics: { views: 999 } },
        { postId: null, platform: "tiktok", metrics: { views: 5 } },
      ],
    });
    const pub = new ZernioPublisher("tiktok", new ZernioClient("sk_test", undefined, f, 0), tt, { privacy: "x", aiDisclosure: true });
    const s = await pub.stats(["zernio:p1", "123456789"]); // a legacy direct-API id is ignored
    expect(s.get("zernio:p1")).toEqual({ views: 1200, likes: 90, comments: 4, shares: 7, saves: 11, avg_watch_sec: 6.4 });
    expect(s.size).toBe(1);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("postId")).toBe("p1");
    expect(q.get("granularity")).toBe("total");
  });
});

describe("account selection + health", () => {
  it("uses the only connected account, the pinned one, or explains what to do", () => {
    expect(pickAccount([tt, ig], "tiktok")._id).toBe("acc_tt");
    expect(() => pickAccount([ig], "tiktok")).toThrow(/No TikTok account is connected in Zernio/);
    const tt2 = { ...tt, _id: "acc_tt2", username: "second" };
    expect(() => pickAccount([tt, tt2], "tiktok")).toThrow(/Several tiktok accounts .*acc_tt2/);
    expect(pickAccount([tt, tt2], "tiktok", "acc_tt2").username).toBe("second");
    expect(() => pickAccount([tt], "tiktok", "nope")).toThrow(/not connected/);
  });

  it("builds publishers only for POST_PLATFORMS and defaults TikTok to public", async () => {
    const { f, calls } = fakeZernio({ accounts: [tt, ig] });
    const cfg = loadConfig({ ZERNIO_API_KEY: "sk_test", POST_PLATFORMS: "tiktok" } as any);
    const pubs = await zernioPublishers(cfg, new ZernioClient("sk_test", undefined, f, 0));
    expect(pubs.map((p) => p.platform)).toEqual(["tiktok"]);
    await pubs[0].publish({ localFile: tmpVideo(), caption: "c", videoId: "v5", mediaUrl: "", title: "" } as any);
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!.body.tiktokSettings.privacyLevel).toBe("PUBLIC_TO_EVERYONE");
  });

  it("reports missing and disconnected accounts", () => {
    const cfg = loadConfig({ ZERNIO_API_KEY: "k" } as any);
    expect(zernioAccountIssues([], cfg)).toEqual([expect.stringMatching(/No TikTok account/), expect.stringMatching(/No Instagram account/)]);
    expect(zernioAccountIssues([tt, { ...ig, needsReconnect: true }], cfg)).toEqual([expect.stringMatching(/instagram account @studyapp.ig needs reconnecting/)]);
  });
});
