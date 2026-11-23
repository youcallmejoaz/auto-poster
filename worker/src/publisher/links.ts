import type { Platform } from "../core/types";

/**
 * Per-video tracked link. Use it as the link-in-bio target while the video is "current",
 * or behind a link-in-bio page that lists recent videos. Attribution tools (Branch/AppsFlyer/
 * App Store campaign links) report installs per link, which the analytics stage reads.
 */
export function trackedLink(base: string, videoId: string, platform: Platform): string {
  const u = new URL(base);
  const code = videoId.replace(/-/g, "").slice(0, 10);
  u.searchParams.set("utm_source", platform);
  u.searchParams.set("utm_medium", "short_video");
  u.searchParams.set("utm_campaign", "studyshorts");
  u.searchParams.set("utm_content", code);
  u.searchParams.set("ct", `ss_${code}`); // App Store Connect campaign token
  return u.toString();
}

export function buildCaption(caption: string, hashtags: string[], max = 2200): string {
  const tags = hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return `${caption.trim()}\n\n${tags}`.slice(0, max);
}

/** Is `now` within ±windowMin of one of the HH:MM UTC slots? */
export function inPostingSlot(now: Date, slots: string, windowMin = 30): boolean {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return slots
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => {
      const [h, m] = s.split(":").map(Number);
      const d = Math.abs(mins - (h * 60 + (m || 0)));
      return Math.min(d, 1440 - d) <= windowMin;
    });
}
