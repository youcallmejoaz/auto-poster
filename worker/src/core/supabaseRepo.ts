import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Repo } from "./repo";
import type { Asset, AssetKind, AttributionRow, Brief, Insight, JobRun, MetricSnapshot, Post, ResearchItem, Video, VideoStatus } from "./types";
import type { StoredSetting } from "./settings";

const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;
  constructor(url: string, serviceKey: string, private bucket = "videos") {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async upsertResearch(items: ResearchItem[]) {
    if (!items.length) return 0;
    const rows = check(await this.db.from("research_items").upsert(items, { onConflict: "url" }).select("id"));
    return (rows as unknown[]).length;
  }
  async recentResearch(sinceDays: number) {
    return check(await this.db.from("research_items").select("*").gte("fetched_at", since(sinceDays)).limit(2000)) as ResearchItem[];
  }
  async insertInsights(items: Insight[]) {
    if (!items.length) return [];
    return check(await this.db.from("insights").insert(items).select()) as Insight[];
  }
  async topInsights(limit: number, sinceDays = 14) {
    return check(await this.db.from("insights").select("*").gte("created_at", since(sinceDays)).order("evidence_score", { ascending: false }).limit(limit)) as Insight[];
  }
  async insertBriefs(items: Brief[]) {
    if (!items.length) return [];
    return check(await this.db.from("briefs").insert(items).select()) as Brief[];
  }
  async openBriefs(limit: number) {
    return check(await this.db.from("briefs").select("*").eq("status", "open").order("priority", { ascending: false }).order("created_at").limit(limit)) as Brief[];
  }
  async setBriefStatus(id: string, status: Brief["status"]) {
    check(await this.db.from("briefs").update({ status }).eq("id", id));
  }
  async insertVideo(v: Video) {
    return check(await this.db.from("videos").insert(v).select().single()) as Video;
  }
  async updateVideo(id: string, patch: Partial<Video>) {
    check(await this.db.from("videos").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
  }
  async getVideo(id: string) {
    return check(await this.db.from("videos").select("*").eq("id", id).maybeSingle()) as Video | null;
  }
  async videosByStatus(status: VideoStatus, limit = 100) {
    return check(await this.db.from("videos").select("*").eq("status", status).order("created_at").limit(limit)) as Video[];
  }
  async uploadVideo(localPath: string, key: string) {
    check(await this.db.storage.from(this.bucket).upload(key, fs.readFileSync(localPath), { contentType: "video/mp4", upsert: true }));
    return key;
  }
  async signedVideoUrl(storagePath: string, expiresSec: number) {
    const r = check(await this.db.storage.from(this.bucket).createSignedUrl(storagePath, expiresSec)) as { signedUrl: string };
    return r.signedUrl;
  }
  async insertPost(p: Post) {
    return check(await this.db.from("posts").upsert(p, { onConflict: "video_id,platform" }).select().single()) as Post;
  }
  async updatePost(id: string, patch: Partial<Post>) {
    check(await this.db.from("posts").update(patch).eq("id", id));
  }
  async postsSince(sinceDays: number) {
    return check(await this.db.from("posts").select("*").not("posted_at", "is", null).gte("posted_at", since(sinceDays))) as Post[];
  }
  async postsForVideo(videoId: string) {
    return check(await this.db.from("posts").select("*").eq("video_id", videoId)) as Post[];
  }
  async insertMetrics(m: MetricSnapshot[]) {
    if (m.length) check(await this.db.from("metrics").insert(m));
  }
  async latestMetrics(postIds: string[]) {
    const out = new Map<string, MetricSnapshot>();
    if (!postIds.length) return out;
    const rows = check(await this.db.from("metrics").select("*").in("post_id", postIds).order("snapshot_at", { ascending: false })) as MetricSnapshot[];
    for (const r of rows) if (!out.has(r.post_id)) out.set(r.post_id, r);
    return out;
  }
  async startRun(stage: string) {
    return check(await this.db.from("job_runs").insert({ stage, status: "running" }).select().single()) as JobRun;
  }
  async finishRun(id: string, patch: Partial<JobRun>) {
    check(await this.db.from("job_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id));
  }
  async runsSince(hours: number) {
    return check(await this.db.from("job_runs").select("*").gte("started_at", new Date(Date.now() - hours * 36e5).toISOString())) as JobRun[];
  }

  async listVideos({ status, limit = 100 }: { status?: VideoStatus; limit?: number }) {
    let q = this.db.from("videos").select("*").order("created_at", { ascending: false }).limit(limit);
    if (status) q = q.eq("status", status);
    return check(await q) as Video[];
  }
  async listBriefs(status?: Brief["status"], limit = 100) {
    let q = this.db.from("briefs").select("*").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    if (status) q = q.eq("status", status);
    return check(await q) as Brief[];
  }
  async listRuns(limit: number) {
    return check(await this.db.from("job_runs").select("*").order("started_at", { ascending: false }).limit(limit)) as JobRun[];
  }
  async getSettings() {
    return check(await this.db.from("settings").select("*")) as StoredSetting[];
  }
  async setSetting(s: StoredSetting) {
    check(await this.db.from("settings").upsert({ ...s, updated_at: new Date().toISOString() }));
  }
  async deleteSetting(key: string) {
    check(await this.db.from("settings").delete().eq("key", key));
  }
  async listAssets(kind?: AssetKind) {
    let q = this.db.from("assets").select("*").order("created_at", { ascending: false });
    if (kind) q = q.eq("kind", kind);
    return check(await q) as Asset[];
  }
  async insertAsset(a: Asset) {
    return check(await this.db.from("assets").insert(a).select().single()) as Asset;
  }
  async deleteAsset(id: string) {
    const a = check(await this.db.from("assets").select("*").eq("id", id).maybeSingle()) as Asset | null;
    if (!a) return;
    await this.db.storage.from("assets").remove([a.storage_path]);
    check(await this.db.from("assets").delete().eq("id", id));
  }
  async signedAssetUrl(storagePath: string, expiresSec: number) {
    const r = check(await this.db.storage.from("assets").createSignedUrl(storagePath, expiresSec)) as { signedUrl: string };
    return r.signedUrl;
  }
  async createAssetUpload(storagePath: string) {
    const r = check(await this.db.storage.from("assets").createSignedUploadUrl(storagePath)) as { signedUrl: string };
    return { url: r.signedUrl };
  }
  async upsertAttribution(rows: AttributionRow[]) {
    if (rows.length) check(await this.db.from("attribution").upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }))));
  }
  async getAttribution() {
    return check(await this.db.from("attribution").select("*")) as AttributionRow[];
  }
  async logClick(code: string, platform: string | null) {
    check(await this.db.from("link_clicks").insert({ code, platform }));
  }
  async clickCounts() {
    const rows = check(await this.db.from("link_clicks").select("code").gte("clicked_at", since(90)).limit(100000)) as { code: string }[];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.code, (m.get(r.code) ?? 0) + 1);
    return m;
  }
  async latestPost(platform?: string) {
    let q = this.db.from("posts").select("*").not("posted_at", "is", null).order("posted_at", { ascending: false }).limit(1);
    if (platform) q = q.eq("platform", platform);
    const rows = check(await q) as Post[];
    return rows[0] ?? null;
  }
}
