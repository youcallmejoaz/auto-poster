import "server-only";
import { scoreVideos, type VideoPerf } from "worker/analytics";
import type { Repo } from "worker/repo";
import type { MetricSnapshot, Post } from "worker/types";

export const fmtNum = (n: number | null | undefined) => (n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export function ago(iso?: string | null) {
  if (!iso) return "–";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const scoreBadge = (s?: number | null) => (s == null ? "" : s >= 7.5 ? "ok" : s >= 6 ? "warn" : "bad");

/** Same scoring the analytics stage uses, for posted videos from the last `days`. */
export async function videoPerformance(repo: Repo, days = 30): Promise<(VideoPerf & { posts: Post[] })[]> {
  const posts = await repo.postsSince(days);
  const latest = await repo.latestMetrics(posts.map((p) => p.id!));
  const byVideo = new Map<string, { posts: Post[]; metrics: MetricSnapshot[] }>();
  for (const p of posts) {
    const e = byVideo.get(p.video_id) ?? { posts: [], metrics: [] };
    e.posts.push(p);
    const m = latest.get(p.id!);
    if (m) e.metrics.push(m);
    byVideo.set(p.video_id, e);
  }
  const rows: { video: import("worker/types").Video; posts: Post[]; metrics: MetricSnapshot[] }[] = [];
  for (const [id, e] of byVideo) {
    const video = await repo.getVideo(id);
    if (video) rows.push({ video, ...e });
  }
  const scored = scoreVideos(rows);
  return scored.map((s, i) => ({ ...s, posts: rows[i].posts })).sort((a, b) => b.score - a.score);
}

export async function videoUrl(repo: Repo, storagePath?: string | null) {
  return storagePath ? repo.signedVideoUrl(storagePath, 3 * 3600) : null;
}
