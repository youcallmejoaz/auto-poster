import type { Brief, Insight, JobRun, MetricSnapshot, Post, ResearchItem, Video, VideoStatus } from "./types";

/** Storage abstraction: Supabase in prod, in-memory for tests and dry runs. */
export interface Repo {
  upsertResearch(items: ResearchItem[]): Promise<number>;
  recentResearch(sinceDays: number): Promise<ResearchItem[]>;
  insertInsights(items: Insight[]): Promise<Insight[]>;
  topInsights(limit: number, sinceDays?: number): Promise<Insight[]>;

  insertBriefs(items: Brief[]): Promise<Brief[]>;
  openBriefs(limit: number): Promise<Brief[]>;
  setBriefStatus(id: string, status: Brief["status"]): Promise<void>;

  insertVideo(v: Video): Promise<Video>;
  updateVideo(id: string, patch: Partial<Video>): Promise<void>;
  getVideo(id: string): Promise<Video | null>;
  videosByStatus(status: VideoStatus, limit?: number): Promise<Video[]>;
  uploadVideo(localPath: string, key: string): Promise<string>;
  /** Short-lived public URL for platforms that pull media by URL (IG, TikTok PULL_FROM_URL). */
  signedVideoUrl(storagePath: string, expiresSec: number): Promise<string>;

  insertPost(p: Post): Promise<Post>;
  updatePost(id: string, patch: Partial<Post>): Promise<void>;
  postsSince(sinceDays: number): Promise<Post[]>;
  postsForVideo(videoId: string): Promise<Post[]>;

  insertMetrics(m: MetricSnapshot[]): Promise<void>;
  latestMetrics(postIds: string[]): Promise<Map<string, MetricSnapshot>>;

  startRun(stage: string): Promise<JobRun>;
  finishRun(id: string, patch: Partial<JobRun>): Promise<void>;
  runsSince(hours: number): Promise<JobRun[]>;
}
