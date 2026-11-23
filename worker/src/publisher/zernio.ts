import fs from "node:fs";
import path from "node:path";
import type { Config } from "../core/env";
import type { Platform } from "../core/types";
import type { PlatformStats, Publisher } from "./platforms";

/**
 * Zernio (https://zernio.com) REST client: posts to TikTok and Instagram through Zernio's own
 * approved platform apps, so no TikTok/Meta developer app, OAuth domain or TikTok audit is needed.
 * Shapes follow https://zernio.com/openapi.yaml (base https://zernio.com/api/v1, Bearer auth).
 */

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
  needsReconnect?: boolean;
  profileUrl?: string;
}

export interface ZernioPlatformTarget {
  platform: string;
  accountId: string | { _id: string };
  status?: string; // pending | processing | uploading | published | failed | cancelled
  platformPostId?: string;
  platformPostUrl?: string | null;
  errorMessage?: string;
  errorCategory?: string;
}

export interface ZernioPost {
  _id: string;
  status: string; // draft | pending_approval | scheduled | publishing | published | partial | failed | cancelled
  platforms: ZernioPlatformTarget[];
}

export class ZernioError extends Error {
  constructor(message: string, public status: number, public body: any) {
    super(message);
  }
}

export class ZernioClient {
  private uploads = new Map<string, string>(); // local file -> publicUrl (upload once per run)
  constructor(private apiKey: string, private base = "https://zernio.com/api/v1", private f: Fetch = fetch, private pollMs = 15000) {}

  private async req<T = any>(method: string, pathAndQuery: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.f(`${this.base}${pathAndQuery}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    if (!res.ok && res.status !== 207) {
      const msg = json?.error?.message ?? json?.error ?? json?.message ?? text.slice(0, 300);
      throw new ZernioError(`Zernio ${method} ${pathAndQuery.split("?")[0]} → ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, json);
    }
    return json as T;
  }

  async listAccounts(): Promise<ZernioAccount[]> {
    const r = await this.req<{ accounts: ZernioAccount[] }>("GET", "/accounts");
    return r.accounts ?? [];
  }

  /** Presigned upload: POST /media/presign, PUT the bytes, use publicUrl in posts. */
  async uploadVideo(localFile: string): Promise<string> {
    const cached = this.uploads.get(localFile);
    if (cached) return cached;
    const buf = fs.readFileSync(localFile);
    const p = await this.req<{ uploadUrl: string; publicUrl: string }>("POST", "/media/presign", { filename: path.basename(localFile), contentType: "video/mp4", size: buf.length });
    if (!p.uploadUrl || !p.publicUrl) throw new Error("Zernio presign returned no uploadUrl/publicUrl");
    const put = await this.f(p.uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: buf });
    if (!put.ok) throw new Error(`Zernio media upload failed: ${put.status} ${(await put.text()).slice(0, 200)}`);
    this.uploads.set(localFile, p.publicUrl);
    return p.publicUrl;
  }

  async createPost(body: Record<string, unknown>, idempotencyKey: string): Promise<ZernioPost> {
    try {
      const r = await this.req<{ post: ZernioPost }>("POST", "/posts", body, { "Idempotency-Key": idempotencyKey });
      return r.post;
    } catch (e) {
      // Same content already posted to this account in the last 24h (e.g. a retry): reuse the original.
      if (e instanceof ZernioError && e.status === 409 && e.body?.existingPostId) return this.getPost(e.body.existingPostId);
      throw e;
    }
  }

  async getPost(id: string): Promise<ZernioPost> {
    const r = await this.req<{ post?: ZernioPost } & ZernioPost>("GET", `/posts/${encodeURIComponent(id)}`);
    return (r.post ?? r) as ZernioPost;
  }

  /** Polls until the platform entry reaches a final state, or the timeout passes (returns the last state). */
  async waitForPlatform(id: string, platform: string, timeoutMs: number): Promise<ZernioPlatformTarget | undefined> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const post = await this.getPost(id);
      const t = post.platforms?.find((x) => x.platform === platform);
      if (!t || ["published", "failed", "cancelled"].includes(t.status ?? "") || Date.now() >= until) return t;
      await sleep(this.pollMs);
    }
  }

  /** Per-platform metric rows for Zernio post ids (GET /metrics/posts, up to 100 ids per call). */
  async postMetrics(postIds: string[]): Promise<{ postId: string | null; platform: string; platformPostId?: string; metrics: Record<string, number> }[]> {
    const rows: any[] = [];
    for (let i = 0; i < postIds.length; i += 100) {
      const q = new URLSearchParams({ postId: postIds.slice(i, i + 100).join(","), granularity: "total", metrics: "views,likes,comments,shares,saves,averageWatchTime,completionRate" });
      let cursor: string | null = null;
      do {
        if (cursor) q.set("cursor", cursor);
        const r: any = await this.req("GET", `/metrics/posts?${q}`);
        rows.push(...(r.data ?? []));
        cursor = r.pagination?.hasMore ? r.pagination.nextCursor : null;
      } while (cursor);
    }
    return rows;
  }
}

export const ZERNIO_PREFIX = "zernio:";

/** Picks the Zernio account for a platform: the pinned id, or the only active connected one. */
export function pickAccount(accounts: ZernioAccount[], platform: Platform, pinned?: string): ZernioAccount {
  if (pinned) {
    const a = accounts.find((x) => x._id === pinned);
    if (!a) throw new Error(`Zernio ${platform} account ${pinned} is not connected to this API key`);
    return a;
  }
  const usable = accounts.filter((a) => a.platform === platform && a.isActive !== false);
  if (usable.length === 0) throw new Error(`No ${platform === "tiktok" ? "TikTok" : "Instagram"} account is connected in Zernio. Connect one at zernio.com.`);
  if (usable.length > 1) throw new Error(`Several ${platform} accounts are connected in Zernio (${usable.map((a) => `@${a.username} = ${a._id}`).join(", ")}). Set the account ID in Settings → Zernio.`);
  return usable[0];
}

export interface ZernioPublishOptions {
  privacy: string;
  aiDisclosure: boolean;
  /** How long to wait for the platform to confirm publishing (TikTok can take a few minutes). */
  waitMs?: number;
}

/** One Zernio-backed publisher per platform; both share a client so the video uploads once. */
export class ZernioPublisher implements Publisher {
  constructor(public platform: Platform, private client: ZernioClient, private account: ZernioAccount, private opts: ZernioPublishOptions) {}

  buildBody(mediaUrl: string, caption: string, videoId: string) {
    const target: Record<string, unknown> = { platform: this.platform, accountId: this.account._id };
    if (this.platform === "instagram") target.platformSpecificData = { shareToFeed: true, isAiGenerated: this.opts.aiDisclosure };
    const body: Record<string, unknown> = {
      content: caption,
      mediaItems: [{ type: "video", url: mediaUrl, mimeType: "video/mp4" }],
      platforms: [target],
      // A near-future schedule rather than publishNow: publishNow holds the HTTP request open while
      // TikTok/Instagram process the video, which can outlast client timeouts. We poll instead.
      scheduledFor: new Date(Date.now() + 30_000).toISOString(),
      externalId: videoId,
      metadata: { source: "studyshorts", videoId },
    };
    if (this.platform === "tiktok") {
      body.tiktokSettings = {
        privacyLevel: this.opts.privacy,
        allowComment: true,
        allowDuet: true,
        allowStitch: true,
        // The video was reviewed and approved in the dashboard before reaching this point.
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
        videoMadeWithAi: this.opts.aiDisclosure,
      };
    }
    return body;
  }

  async publish(input: { localFile: string; caption: string; videoId?: string }) {
    const mediaUrl = await this.client.uploadVideo(input.localFile);
    const videoId = input.videoId ?? path.basename(input.localFile, ".mp4");
    const post = await this.client.createPost(this.buildBody(mediaUrl, input.caption, videoId), `studyshorts:${videoId}:${this.platform}`);
    const t = await this.client.waitForPlatform(post._id, this.platform, this.opts.waitMs ?? 8 * 60_000);
    if (t?.status === "failed" || t?.status === "cancelled") throw new Error(`Zernio ${this.platform} publish ${t.status}: ${t.errorMessage ?? "no reason given"}${t.errorCategory ? ` (${t.errorCategory})` : ""}`);
    return `${ZERNIO_PREFIX}${post._id}`;
  }

  async stats(externalIds: string[]) {
    const out = new Map<string, PlatformStats>();
    const ids = externalIds.filter((x) => x.startsWith(ZERNIO_PREFIX)).map((x) => x.slice(ZERNIO_PREFIX.length));
    if (!ids.length) return out;
    const rows = await this.client.postMetrics(ids);
    for (const r of rows) {
      if (r.platform !== this.platform || !r.postId) continue;
      const m = r.metrics ?? {};
      out.set(`${ZERNIO_PREFIX}${r.postId}`, {
        views: m.views ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
        saves: m.saves ?? 0,
        avg_watch_sec: m.averageWatchTime != null ? m.averageWatchTime / 1000 : null, // Zernio reports milliseconds
      });
    }
    return out;
  }
}

export const postPlatforms = (cfg: Config): Platform[] =>
  cfg.POST_PLATFORMS.split(",").map((s) => s.trim().toLowerCase()).filter((s): s is Platform => s === "tiktok" || s === "instagram");

/** Builds publishers for every platform in POST_PLATFORMS from the accounts connected in Zernio. */
export async function zernioPublishers(cfg: Config, client = new ZernioClient(cfg.ZERNIO_API_KEY!, cfg.ZERNIO_BASE_URL)): Promise<ZernioPublisher[]> {
  const accounts = await client.listAccounts();
  const opts = { privacy: cfg.TIKTOK_PRIVACY ?? "PUBLIC_TO_EVERYONE", aiDisclosure: cfg.AI_DISCLOSURE };
  return postPlatforms(cfg).map((p) => new ZernioPublisher(p, client, pickAccount(accounts, p, p === "tiktok" ? cfg.ZERNIO_TIKTOK_ACCOUNT_ID : cfg.ZERNIO_INSTAGRAM_ACCOUNT_ID), opts));
}

/** Health summary for the supervisor/dashboard: missing or disconnected accounts. */
export function zernioAccountIssues(accounts: ZernioAccount[], cfg: Config): string[] {
  const issues: string[] = [];
  for (const p of postPlatforms(cfg)) {
    const pinned = p === "tiktok" ? cfg.ZERNIO_TIKTOK_ACCOUNT_ID : cfg.ZERNIO_INSTAGRAM_ACCOUNT_ID;
    const mine = accounts.filter((a) => (pinned ? a._id === pinned : a.platform === p));
    if (!mine.length) issues.push(`No ${p === "tiktok" ? "TikTok" : "Instagram"} account connected in Zernio. Connect it at zernio.com, or remove it from "Post to".`);
    for (const a of mine) if (a.needsReconnect || a.isActive === false) issues.push(`Zernio ${p} account @${a.username ?? a._id} needs reconnecting at zernio.com.`);
  }
  return issues;
}
