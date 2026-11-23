import fs from "node:fs";
import { http, sleep } from "../core/context";
import type { Platform } from "../core/types";

export interface PlatformStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avg_watch_sec?: number | null;
}

export interface Publisher {
  platform: Platform;
  /** mediaUrl: short-lived public URL; localFile: same video on disk. Returns the platform media id. */
  publish(input: { mediaUrl: string; localFile: string; caption: string; title: string }): Promise<string>;
  stats(externalIds: string[]): Promise<Map<string, PlatformStats>>;
}

/**
 * Instagram Reels via the official Graph API (Instagram Login or Facebook Login for Business).
 * Needs an IG Business/Creator account and a token with instagram_content_publish + insights scopes.
 */
export class InstagramPublisher implements Publisher {
  platform = "instagram" as const;
  constructor(private userId: string, private token: string, private version = "v23.0") {}
  private url(path: string, params: Record<string, string> = {}) {
    const u = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    for (const [k, v] of Object.entries({ ...params, access_token: this.token })) u.searchParams.set(k, v);
    return u.toString();
  }

  async publish({ mediaUrl, caption }: { mediaUrl: string; caption: string }) {
    const c = await http<{ id: string }>(this.url(`${this.userId}/media`, { media_type: "REELS", video_url: mediaUrl, caption, share_to_feed: "true" }), { method: "POST" });
    // IG downloads + transcodes asynchronously; wait for FINISHED (up to ~5 min).
    for (let i = 0; i < 60; i++) {
      const s = await http<{ status_code: string; status?: string }>(this.url(c.id, { fields: "status_code,status" }));
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`IG container ${s.status_code}: ${s.status ?? ""}`);
      if (i === 59) throw new Error("IG container processing timed out");
      await sleep(5000);
    }
    const p = await http<{ id: string }>(this.url(`${this.userId}/media_publish`, { creation_id: c.id }), { method: "POST" });
    return p.id;
  }

  async stats(ids: string[]) {
    const out = new Map<string, PlatformStats>();
    for (const id of ids) {
      try {
        const r = await http<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
          this.url(`${id}/insights`, { metric: "views,likes,comments,shares,saved,ig_reels_avg_watch_time" }),
        );
        const m = Object.fromEntries(r.data.map((d) => [d.name, d.total_value?.value ?? d.values?.[0]?.value ?? 0]));
        out.set(id, { views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0, shares: m.shares ?? 0, saves: m.saved ?? 0, avg_watch_sec: m.ig_reels_avg_watch_time != null ? m.ig_reels_avg_watch_time / 1000 : null });
      } catch {
        // Insights lag for very new media; skip and retry next run.
      }
    }
    return out;
  }
}

/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD). Needs video.publish + video.list scopes.
 * Until the app passes TikTok's audit, only SELF_ONLY (private) posts are allowed.
 */
export class TikTokPublisher implements Publisher {
  platform = "tiktok" as const;
  private base = "https://open.tiktokapis.com/v2";
  constructor(private token: string, private privacy = "SELF_ONLY") {}
  private h() {
    return { authorization: `Bearer ${this.token}` };
  }

  async publish({ localFile, title }: { localFile: string; title: string }) {
    const info = await http<{ data: { privacy_level_options: string[]; max_video_post_duration_sec: number } }>(`${this.base}/post/publish/creator_info/query/`, { method: "POST", headers: this.h(), json: {} });
    if (!info.data.privacy_level_options.includes(this.privacy)) throw new Error(`TikTok privacy ${this.privacy} not allowed; options: ${info.data.privacy_level_options.join(",")}`);

    const buf = fs.readFileSync(localFile);
    const init = await http<{ data: { publish_id: string; upload_url: string } }>(`${this.base}/post/publish/video/init/`, {
      method: "POST",
      headers: this.h(),
      json: {
        post_info: { title: title.slice(0, 2200), privacy_level: this.privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: "FILE_UPLOAD", video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 },
      },
    });
    const up = await fetch(init.data.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes 0-${buf.length - 1}/${buf.length}` }, body: buf });
    if (!up.ok) throw new Error(`TikTok upload failed: ${up.status} ${await up.text()}`);

    for (let i = 0; i < 60; i++) {
      const s = await http<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(`${this.base}/post/publish/status/fetch/`, { method: "POST", headers: this.h(), json: { publish_id: init.data.publish_id } });
      if (s.data.status === "PUBLISH_COMPLETE") return String(s.data.publicaly_available_post_id?.[0] ?? `publish:${init.data.publish_id}`);
      if (s.data.status === "FAILED") throw new Error(`TikTok publish failed: ${s.data.fail_reason}`);
      await sleep(5000);
    }
    // Still processing; keep the publish id so it can be reconciled later.
    return `publish:${init.data.publish_id}`;
  }

  async stats(ids: string[]) {
    const out = new Map<string, PlatformStats>();
    const real = ids.filter((i) => !i.startsWith("publish:"));
    for (let i = 0; i < real.length; i += 20) {
      const r = await http<{ data: { videos: { id: string; view_count: number; like_count: number; comment_count: number; share_count: number }[] } }>(
        `${this.base}/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
        { method: "POST", headers: this.h(), json: { filters: { video_ids: real.slice(i, i + 20) } } },
      );
      for (const v of r.data.videos) out.set(String(v.id), { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count, saves: 0, avg_watch_sec: null });
    }
    return out;
  }
}

/** Logs instead of posting. Used for --dry-run. */
export class DryRunPublisher implements Publisher {
  constructor(public platform: Platform, private log: (...a: unknown[]) => void) {}
  async publish(i: { title: string }) {
    this.log(`[dry-run] would publish "${i.title}" to ${this.platform}`);
    return `dry-${this.platform}-${Date.now()}`;
  }
  async stats(ids: string[]) {
    return new Map(ids.map((id) => [id, { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }]));
  }
}
