import fs from "node:fs";
import { z } from "zod/v4";
import { TEMPLATE_IDS } from "renderer/schema";
import { ask, runStage, type Ctx } from "../core/context";
import type { Brief, MetricSnapshot, Post, Video } from "../core/types";
import type { Publisher } from "../publisher/platforms";

/** Installs per tracked link, from your attribution tool's export: { "<utm_content code>": { clicks, installs } }. */
export interface Attribution {
  lookup(trackedLink: string): { clicks: number; installs: number } | null;
}

export class FileAttribution implements Attribution {
  private data: Record<string, { clicks?: number; installs?: number }>;
  constructor(file: string) {
    this.data = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  lookup(link: string) {
    const code = new URL(link).searchParams.get("utm_content") ?? "";
    const d = this.data[code] ?? this.data[link];
    return d ? { clicks: d.clicks ?? 0, installs: d.installs ?? 0 } : null;
  }
}

export const noAttribution: Attribution = { lookup: () => null };

export const linkCode = (link: string) => new URL(link).searchParams.get("utm_content") ?? "";

/**
 * Attribution imported via the dashboard (attribution table), plus clicks counted by the
 * dashboard's /go link-in-bio redirect when the import has no click numbers.
 */
export class DbAttribution implements Attribution {
  private constructor(private rows: Map<string, { clicks: number; installs: number }>, private clicks: Map<string, number>) {}
  static async load(repo: import("../core/repo").Repo) {
    const rows = new Map((await repo.getAttribution()).map((r) => [r.code, { clicks: Number(r.clicks), installs: Number(r.installs) }]));
    return new DbAttribution(rows, await repo.clickCounts());
  }
  lookup(link: string) {
    const code = linkCode(link);
    const r = this.rows.get(code);
    const c = this.clicks.get(code);
    if (!r && c == null) return null;
    return { clicks: r?.clicks || c || 0, installs: r?.installs ?? 0 };
  }
}

/** Pulls current stats for posts from the last `days` days and stores a snapshot per post. */
export async function collectMetrics(ctx: Ctx, publishers: Publisher[], attribution: Attribution, days = 14) {
  const posts = await ctx.repo.postsSince(days);
  const snaps: MetricSnapshot[] = [];
  for (const pub of publishers) {
    const mine = posts.filter((p) => p.platform === pub.platform && p.external_id);
    if (!mine.length) continue;
    const stats = await pub.stats(mine.map((p) => p.external_id!));
    for (const p of mine) {
      const s = stats.get(p.external_id!);
      if (!s) continue;
      const a = attribution.lookup(p.tracked_link);
      snaps.push({ post_id: p.id!, snapshot_at: new Date().toISOString(), ...s, link_clicks: a?.clicks ?? null, installs: a?.installs ?? null });
    }
  }
  await ctx.repo.insertMetrics(snaps);
  return snaps.length;
}

export interface VideoPerf {
  video: Video;
  ageHours: number;
  views: number;
  engagementRate: number;
  installs: number | null;
  installsPer1k: number | null;
  avgWatchSec: number | null;
  score: number; // 0-100, relative to the cohort
}

const pctRank = (vals: number[], v: number) => (vals.length <= 1 ? 0.5 : vals.filter((x) => x < v).length / (vals.length - 1));

/**
 * Scores each video relative to its cohort (percentile ranks are robust to viral outliers).
 * When install attribution exists, installs per 1k views dominate - that's the business goal.
 */
export function scoreVideos(rows: { video: Video; posts: Post[]; metrics: MetricSnapshot[] }[], now = Date.now()): VideoPerf[] {
  const base = rows.map(({ video, posts, metrics }) => {
    const sum = (k: keyof MetricSnapshot) => metrics.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const views = sum("views");
    const eng = views ? (sum("likes") + 2 * sum("comments") + 3 * sum("shares") + 2 * sum("saves")) / views : 0;
    const hasInstalls = metrics.some((m) => m.installs != null);
    const installs = hasInstalls ? sum("installs") : null;
    const watch = metrics.map((m) => m.avg_watch_sec).filter((x): x is number => x != null);
    const firstPost = Math.min(...posts.map((p) => Date.parse(p.posted_at ?? new Date(now).toISOString())));
    return {
      video,
      ageHours: (now - firstPost) / 36e5,
      views,
      engagementRate: eng,
      installs,
      installsPer1k: installs != null && views ? (installs / views) * 1000 : installs != null ? 0 : null,
      avgWatchSec: watch.length ? watch.reduce((a, b) => a + b, 0) / watch.length : null,
      score: 0,
    };
  });
  const lv = base.map((b) => Math.log1p(b.views));
  const er = base.map((b) => b.engagementRate);
  const ip = base.filter((b) => b.installsPer1k != null).map((b) => b.installsPer1k!);
  const useInstalls = ip.length >= 3;
  return base.map((b) => {
    const pv = pctRank(lv, Math.log1p(b.views));
    const pe = pctRank(er, b.engagementRate);
    const s = useInstalls && b.installsPer1k != null ? 0.5 * pctRank(ip, b.installsPer1k) + 0.3 * pv + 0.2 * pe : 0.6 * pv + 0.4 * pe;
    return { ...b, score: Math.round(s * 100) };
  });
}

const FeedbackOut = z.object({
  summary: z.string().describe("2-4 sentences: what is working and what isn't"),
  briefs: z
    .array(
      z.object({
        kind: z.enum(["variant", "recut", "new"]).describe("variant: new video reusing a winner's angle; recut: edit an existing video; new: fresh idea"),
        parent_video_id: z.string().describe("Required for variant/recut: id from the table. Empty string for new."),
        instruction: z.string(),
        template: z.enum(TEMPLATE_IDS),
        priority: z.number().int().describe("0-100"),
      }),
    )
    .describe("3-6 briefs"),
  stop_doing: z.array(z.string()).describe("Patterns to avoid going forward"),
});

const MAX_OPEN_BRIEFS = 15;

export async function runAnalytics(ctx: Ctx, publishers: Publisher[], attribution: Attribution) {
  return runStage(ctx, "analytics", async () => {
    const snaps = await collectMetrics(ctx, publishers, attribution);
    const posts = await ctx.repo.postsSince(30);
    const latest = await ctx.repo.latestMetrics(posts.map((p) => p.id!));
    const byVideo = new Map<string, { posts: Post[]; metrics: MetricSnapshot[] }>();
    for (const p of posts) {
      const e = byVideo.get(p.video_id) ?? { posts: [], metrics: [] };
      e.posts.push(p);
      const m = latest.get(p.id!);
      if (m) e.metrics.push(m);
      byVideo.set(p.video_id, e);
    }
    const rows = [];
    for (const [id, e] of byVideo) {
      const video = await ctx.repo.getVideo(id);
      if (video && e.metrics.length) rows.push({ video, ...e });
    }
    // Under 24h, numbers are too noisy to act on.
    const perf = scoreVideos(rows).filter((p) => p.ageHours >= 24).sort((a, b) => b.score - a.score);
    const open = await ctx.repo.openBriefs(100);
    if (perf.length < 3 || open.length >= MAX_OPEN_BRIEFS) return { items: snaps, briefs: 0, scored: perf.length };

    const table = perf
      .slice(0, 25)
      .map((p) => `id=${p.video.id} score=${p.score} template=${p.video.template} views=${p.views} eng=${p.engagementRate.toFixed(3)} installs=${p.installs ?? "n/a"} inst/1k=${p.installsPer1k?.toFixed(2) ?? "n/a"} watch=${p.avgWatchSec?.toFixed(1) ?? "n/a"}s age=${Math.round(p.ageHours)}h\n   hook="${p.video.script.hook.onScreen ?? p.video.script.hook.narration}" beats=${JSON.stringify(p.video.script.beats.map((b) => b.onScreen ?? b.narration))}`)
      .join("\n");

    const out = await ask(ctx, {
      model: ctx.cfg.LLM_MODEL_JUDGE,
      effort: "high",
      system: "You are the performance analyst for a study app's short-video account. Your job is to turn results into the next videos. Optimise for app installs first (when install data exists), then views and engagement. Prefer doubling down on proven winners (variants and recuts) over brand-new ideas, but keep ~1 in 4 briefs exploratory.",
      schema: FeedbackOut,
      prompt: `App: ${ctx.cfg.APP_NAME} - ${ctx.cfg.APP_DESCRIPTION}\nInstall attribution available: ${perf.some((p) => p.installs != null) ? "yes" : "no (optimise for views+engagement)"}\n\nPosted videos (last 30 days, >24h old), best first:\n${table}\n\nOpen briefs already queued: ${open.length}. Write the next briefs.`,
    });

    const ids = new Set(perf.map((p) => p.video.id));
    const briefs: Brief[] = out.briefs.map((b) => {
      const parent = b.kind !== "new" && ids.has(b.parent_video_id) ? b.parent_video_id : null;
      return { origin: "analytics", instruction: `[${b.kind}] ${b.instruction}${out.stop_doing.length ? `\nAvoid: ${out.stop_doing.join("; ")}` : ""}`, template: b.template, parent_video_id: b.kind === "recut" ? parent : null, priority: Math.max(0, Math.min(100, b.priority)), status: "open" as const };
    });
    // Variants reference the winner in the instruction rather than as a parent (they're new videos, not versions).
    out.briefs.forEach((b, i) => {
      if (b.kind === "variant" && ids.has(b.parent_video_id)) briefs[i].instruction += `\nBased on winner ${b.parent_video_id}: hook "${perf.find((p) => p.video.id === b.parent_video_id)!.video.script.hook.onScreen}"`;
    });
    await ctx.repo.insertBriefs(briefs);
    ctx.log(`[analytics] ${out.summary}`);
    return { items: snaps + briefs.length, briefs: briefs.length, scored: perf.length };
  });
}
