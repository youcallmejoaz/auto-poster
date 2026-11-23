import { randomUUID } from "node:crypto";
import type { Repo } from "./repo";
import type { Brief, Insight, JobRun, MetricSnapshot, Post, ResearchItem, Video, VideoStatus } from "./types";

const daysAgo = (d: number) => Date.now() - d * 864e5;
const now = () => new Date().toISOString();

/** In-memory Repo for tests and `--dry-run`. */
export class MemoryRepo implements Repo {
  research: ResearchItem[] = [];
  insights: Insight[] = [];
  briefs: Brief[] = [];
  videos: Video[] = [];
  posts: Post[] = [];
  metrics: MetricSnapshot[] = [];
  runs: JobRun[] = [];
  files = new Map<string, string>();

  async upsertResearch(items: ResearchItem[]) {
    let n = 0;
    for (const it of items) {
      const i = this.research.findIndex((r) => r.url === it.url);
      if (i >= 0) this.research[i] = { ...this.research[i], ...it };
      else { this.research.push({ ...it, id: randomUUID() }); n++; }
    }
    return n;
  }
  async recentResearch(sinceDays: number) {
    return this.research.filter((r) => !r.posted_at || Date.parse(r.posted_at) >= daysAgo(sinceDays));
  }
  async insertInsights(items: Insight[]) {
    const out = items.map((i) => ({ ...i, id: randomUUID(), created_at: now() }));
    this.insights.push(...out);
    return out;
  }
  async topInsights(limit: number, sinceDays = 14) {
    return this.insights
      .filter((i) => !i.created_at || Date.parse(i.created_at) >= daysAgo(sinceDays))
      .sort((a, b) => b.evidence_score - a.evidence_score)
      .slice(0, limit);
  }
  async insertBriefs(items: Brief[]) {
    const out = items.map((b) => ({ ...b, id: randomUUID(), created_at: now() }));
    this.briefs.push(...out);
    return out;
  }
  async openBriefs(limit: number) {
    return this.briefs.filter((b) => b.status === "open").sort((a, b) => b.priority - a.priority).slice(0, limit);
  }
  async setBriefStatus(id: string, status: Brief["status"]) {
    const b = this.briefs.find((x) => x.id === id);
    if (b) b.status = status;
  }
  async insertVideo(v: Video) {
    const out = { ...v, id: randomUUID(), created_at: now() };
    this.videos.push(out);
    return out;
  }
  async updateVideo(id: string, patch: Partial<Video>) {
    const v = this.videos.find((x) => x.id === id);
    if (v) Object.assign(v, patch);
  }
  async getVideo(id: string) {
    return this.videos.find((x) => x.id === id) ?? null;
  }
  async videosByStatus(status: VideoStatus, limit = 100) {
    return this.videos.filter((v) => v.status === status).slice(0, limit);
  }
  async uploadVideo(localPath: string, key: string) {
    this.files.set(key, localPath);
    return key;
  }
  async signedVideoUrl(storagePath: string) {
    return `file://${this.files.get(storagePath) ?? storagePath}`;
  }
  async insertPost(p: Post) {
    const out = { ...p, id: randomUUID() };
    this.posts.push(out);
    return out;
  }
  async updatePost(id: string, patch: Partial<Post>) {
    const p = this.posts.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async postsSince(sinceDays: number) {
    return this.posts.filter((p) => p.posted_at && Date.parse(p.posted_at) >= daysAgo(sinceDays));
  }
  async postsForVideo(videoId: string) {
    return this.posts.filter((p) => p.video_id === videoId);
  }
  async insertMetrics(m: MetricSnapshot[]) {
    this.metrics.push(...m.map((x) => ({ ...x, id: randomUUID() })));
  }
  async latestMetrics(postIds: string[]) {
    const out = new Map<string, MetricSnapshot>();
    for (const m of this.metrics) {
      if (!postIds.includes(m.post_id)) continue;
      const cur = out.get(m.post_id);
      if (!cur || cur.snapshot_at < m.snapshot_at) out.set(m.post_id, m);
    }
    return out;
  }
  async startRun(stage: string) {
    const r: JobRun = { id: randomUUID(), stage, status: "running", started_at: now(), cost_usd: 0, items: 0 };
    this.runs.push(r);
    return r;
  }
  async finishRun(id: string, patch: Partial<JobRun>) {
    const r = this.runs.find((x) => x.id === id);
    if (r) Object.assign(r, { finished_at: now() }, patch);
  }
  async runsSince(hours: number) {
    return this.runs.filter((r) => Date.parse(r.started_at) >= Date.now() - hours * 36e5);
  }
}
