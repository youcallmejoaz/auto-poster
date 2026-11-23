import type { VideoScript } from "renderer/schema";

export type Platform = "tiktok" | "instagram";

export interface ResearchItem {
  id?: string;
  source: string;
  platform: Platform;
  url: string;
  author?: string;
  author_followers?: number;
  caption?: string;
  hook_text?: string;
  duration_sec?: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posted_at?: string;
  tags?: string[];
}

export interface Insight {
  id?: string;
  pattern: string;
  hook_type: string;
  format: string;
  topic: string;
  cta_style: string;
  evidence_score: number;
  example_urls: string[];
  created_at?: string;
}

export type BriefOrigin = "research" | "analytics" | "manual" | "rejection";
export interface Brief {
  id?: string;
  origin: BriefOrigin;
  instruction: string;
  template?: string | null;
  parent_video_id?: string | null;
  priority: number;
  status: "open" | "in_progress" | "done" | "dropped";
  created_at?: string;
}

export type VideoStatus = "draft" | "review" | "approved" | "rejected" | "scheduled" | "posted" | "failed";
export interface Video {
  id?: string;
  brief_id?: string | null;
  parent_video_id?: string | null;
  version: number;
  title: string;
  template: string;
  script: VideoScript;
  caption: string;
  hashtags: string[];
  storage_path?: string | null;
  quality_score?: number | null;
  critique?: unknown;
  status: VideoStatus;
  review_note?: string | null;
  created_at?: string;
}

export interface Post {
  id?: string;
  video_id: string;
  platform: Platform;
  external_id?: string | null;
  tracked_link: string;
  scheduled_for?: string | null;
  posted_at?: string | null;
}

export interface MetricSnapshot {
  id?: string;
  post_id: string;
  snapshot_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avg_watch_sec?: number | null;
  completion_rate?: number | null;
  link_clicks?: number | null;
  installs?: number | null;
}

export interface JobRun {
  id?: string;
  stage: string;
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at?: string | null;
  cost_usd: number;
  items: number;
  error?: string | null;
}
