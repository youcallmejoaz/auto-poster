import { randomUUID } from "node:crypto";
import type { Repo } from "./repo";
import type { Asset, AssetKind, AttributionRow, Brief, Insight, JobRun, MetricSnapshot, Post, ResearchItem, Video, VideoStatus } from "./types";
import type { StoredSetting } from "./settings";

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
  settings = new Map<string, StoredSetting>();
  assets: Asset[] = [];
  attribution = new Map<string, AttributionRow>();
  clicks: { code: string; platform: string | null; at: string }[] = [];
  /** Maps storage paths to URLs (e.g. demo mode serves local files over HTTP). */
  urlFor: (path: string) => string = (p) => `file://${this.files.get(p) ?? p}`;

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
    return this.urlFor(storagePath);
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

  async listVideos({ status, limit = 100 }: { status?: VideoStatus; limit?: number }) {
    return this.videos.filter((v) => !status || v.status === status).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, limit);
  }
  async listBriefs(status?: Brief["status"], limit = 100) {
    return this.briefs.filter((b) => !status || b.status === status).sort((a, b) => b.priority - a.priority).slice(0, limit);
  }
  async listRuns(limit: number) {
    return [...this.runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit);
  }
  async getSettings() {
    return [...this.settings.values()];
  }
  async setSetting(s: StoredSetting) {
    this.settings.set(s.key, { ...s, updated_at: now() });
  }
  async deleteSetting(key: string) {
    this.settings.delete(key);
  }
  async listAssets(kind?: AssetKind) {
    return this.assets.filter((a) => !kind || a.kind === kind);
  }
  async insertAsset(a: Asset) {
    const out = { ...a, id: randomUUID(), created_at: now() };
    this.assets.push(out);
    return out;
  }
  async deleteAsset(id: string) {
    this.assets = this.assets.filter((a) => a.id !== id);
  }
  async signedAssetUrl(storagePath: string) {
    return this.urlFor(storagePath);
  }
  async createAssetUpload(storagePath: string) {
    return { url: `memory://${storagePath}` };
  }
  async upsertAttribution(rows: AttributionRow[]) {
    for (const r of rows) this.attribution.set(r.code, { ...r, updated_at: now() });
  }
  async getAttribution() {
    return [...this.attribution.values()];
  }
  async logClick(code: string, platform: string | null) {
    this.clicks.push({ code, platform, at: now() });
  }
  async clickCounts() {
    const m = new Map<string, number>();
    for (const c of this.clicks) m.set(c.code, (m.get(c.code) ?? 0) + 1);
    return m;
  }
  async latestPost(platform?: string) {
    return [...this.posts].filter((p) => p.posted_at && (!platform || p.platform === platform)).sort((a, b) => b.posted_at!.localeCompare(a.posted_at!))[0] ?? null;
  }
}
