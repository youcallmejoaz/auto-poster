import fs from "node:fs";
import { http } from "../core/context";
import type { Config } from "../core/env";
import type { Platform, ResearchItem } from "../core/types";

/** A research source returns raw posts from the niche. Swap or add sources without touching analysis. */
export interface ResearchSource {
  name: string;
  fetch(): Promise<ResearchItem[]>;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const firstLine = (s?: string) => (s ?? "").split(/\n|(?<=[.!?])\s/)[0]?.slice(0, 200);

/** Maps an Apify TikTok scraper item (clockworks/tiktok-scraper) to a ResearchItem. */
export function mapTikTok(i: any): ResearchItem | null {
  const url = i.webVideoUrl ?? i.url;
  if (!url) return null;
  return {
    source: "apify",
    platform: "tiktok",
    url,
    author: i.authorMeta?.name ?? i.author?.uniqueId,
    author_followers: num(i.authorMeta?.fans ?? i.authorStats?.followerCount),
    caption: i.text ?? "",
    hook_text: firstLine(i.text),
    duration_sec: num(i.videoMeta?.duration ?? i.video?.duration),
    views: num(i.playCount ?? i.stats?.playCount),
    likes: num(i.diggCount ?? i.stats?.diggCount),
    comments: num(i.commentCount ?? i.stats?.commentCount),
    shares: num(i.shareCount ?? i.stats?.shareCount),
    posted_at: i.createTimeISO ?? (i.createTime ? new Date(num(i.createTime) * 1000).toISOString() : undefined),
    tags: (i.hashtags ?? []).map((h: any) => (typeof h === "string" ? h : h.name)).filter(Boolean),
  };
}

/** Maps an Apify Instagram reel scraper item to a ResearchItem. */
export function mapInstagram(i: any): ResearchItem | null {
  const url = i.url ?? (i.shortCode ? `https://www.instagram.com/reel/${i.shortCode}/` : undefined);
  if (!url) return null;
  return {
    source: "apify",
    platform: "instagram",
    url,
    author: i.ownerUsername,
    author_followers: num(i.ownerFollowersCount ?? i.followersCount),
    caption: i.caption ?? "",
    hook_text: firstLine(i.caption),
    duration_sec: num(i.videoDuration),
    views: num(i.videoPlayCount ?? i.videoViewCount ?? i.playsCount),
    likes: num(i.likesCount),
    comments: num(i.commentsCount),
    shares: num(i.sharesCount),
    posted_at: i.timestamp,
    tags: i.hashtags ?? [],
  };
}

/**
 * Apify actors (paid). Uses the official run-sync-get-dataset-items endpoint.
 * Scraping terms-of-service risk sits with the actor vendor; keep volumes modest.
 */
export class ApifySource implements ResearchSource {
  name = "apify";
  constructor(private cfg: Config, private perHashtag = 30) {}

  private async run(actor: string, input: unknown) {
    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=300`;
    return http<any[]>(url, { method: "POST", json: input, headers: { authorization: `Bearer ${this.cfg.APIFY_TOKEN}` } });
  }

  async fetch() {
    const tags = this.cfg.NICHE_HASHTAGS.split(",").map((s) => s.trim()).filter(Boolean);
    const accounts = this.cfg.COMPETITOR_ACCOUNTS.split(",").map((s) => s.trim()).filter(Boolean);
    const [tt, ig] = await Promise.all([
      this.run(this.cfg.APIFY_TIKTOK_ACTOR, { hashtags: tags, profiles: accounts, resultsPerPage: this.perHashtag, shouldDownloadVideos: false }),
      this.run(this.cfg.APIFY_INSTAGRAM_ACTOR, { username: accounts.length ? accounts : tags, resultsLimit: this.perHashtag }),
    ]);
    return [...tt.map(mapTikTok), ...ig.map(mapInstagram)].filter((x): x is ResearchItem => !!x);
  }
}

/**
 * Manual import fallback: CSV with header
 * platform,url,author,author_followers,caption,views,likes,comments,shares,posted_at
 * Useful for TikTok Creative Center exports or hand-picked examples.
 */
export class CsvSource implements ResearchSource {
  name = "csv";
  constructor(private file: string) {}
  async fetch() {
    return parseResearchCsv(fs.readFileSync(this.file, "utf8"));
  }
}

export function parseResearchCsv(text: string): ResearchItem[] {
  const rows = parseCsv(text);
  const [head, ...body] = rows;
  if (!head) return [];
  const idx = (k: string) => head.indexOf(k);
  return body
    .filter((r) => r[idx("url")])
    .map((r) => ({
      source: "csv",
      platform: (r[idx("platform")] || "tiktok") as Platform,
      url: r[idx("url")],
      author: r[idx("author")] || undefined,
      author_followers: num(r[idx("author_followers")]),
      caption: r[idx("caption")] ?? "",
      hook_text: firstLine(r[idx("caption")]),
      views: num(r[idx("views")]),
      likes: num(r[idx("likes")]),
      comments: num(r[idx("comments")]),
      shares: num(r[idx("shares")]),
      posted_at: r[idx("posted_at")] || undefined,
    }));
}

/** Minimal RFC4180 CSV parser (quoted fields, escaped quotes, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.some((x) => x !== "")) out.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x !== "")) out.push(row);
  return out.map((r) => r.map((x) => x.trim()));
}
