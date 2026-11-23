import { VideoScript } from "renderer/schema";
import type { MemoryRepo } from "worker/memoryRepo";
import listicle from "../../renderer/fixtures/listicle.json";
import pov from "../../renderer/fixtures/pov.json";
import studyHack from "../../renderer/fixtures/studyHack.json";

const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Sample data for DEMO_MODE so every screen has something to show. */
export function seedDemo(m: MemoryRepo) {
  const scripts = { listicle: VideoScript.parse(listicle), pov: VideoScript.parse(pov), studyHack: VideoScript.parse(studyHack) };
  const critique = (score: number, issues: string[]) => ({ score, hook_score: score, readability_score: 8, issues, revision_instructions: "" });

  m.research = [
    { id: id(101), source: "apify", platform: "tiktok", url: "https://www.tiktok.com/@studywithkai/video/1", author: "studywithkai", author_followers: 8200, caption: "POV: you open the 90 page PDF the night before 💀 #studytok", hook_text: "POV: you open the 90 page PDF the night before 💀", views: 412000, likes: 51000, comments: 830, shares: 6100, posted_at: ago(90) },
    { id: id(102), source: "apify", platform: "instagram", url: "https://www.instagram.com/reel/abc/", author: "medschoolmia", author_followers: 120000, caption: "3 ways to remember everything for finals", hook_text: "3 ways to remember everything for finals", views: 980000, likes: 64000, comments: 1200, shares: 9800, posted_at: ago(120) },
    { id: id(103), source: "apify", platform: "tiktok", url: "https://www.tiktok.com/@notesbynora/video/2", author: "notesbynora", author_followers: 2100, caption: "the blurting method changed my grades", hook_text: "the blurting method changed my grades", views: 156000, likes: 21000, comments: 410, shares: 3300, posted_at: ago(60) },
  ];
  m.insights = [
    { id: id(201), pattern: "Relatable 'night before the exam' panic, app appears as the turning point", hook_type: "pov", format: "pov", topic: "exam cramming", cta_style: "soft reveal", evidence_score: 0.86, example_urls: [m.research[0].url], created_at: ago(20) },
    { id: id(202), pattern: "Numbered memory techniques with a concrete, named method per beat", hook_type: "listicle", format: "listicle", topic: "memory", cta_style: "tool that automates the method", evidence_score: 0.78, example_urls: [m.research[1].url], created_at: ago(20) },
    { id: id(203), pattern: "Named study method + 'changed my grades' outcome claim", hook_type: "bold_claim", format: "studyHack", topic: "active recall", cta_style: "app does it for you", evidence_score: 0.71, example_urls: [m.research[2].url], created_at: ago(20) },
  ];
  m.briefs = [
    { id: id(301), origin: "analytics", instruction: "[variant] Same POV panic angle but for med school anatomy exams", template: "pov", priority: 85, status: "open", created_at: ago(5) },
    { id: id(302), origin: "research", instruction: "Show the app turning a lecture PDF into flashcards in under 10 seconds", template: "appDemo", priority: 75, status: "open", created_at: ago(20) },
    { id: id(303), origin: "manual", instruction: "Finals week survival checklist", template: "listicle", priority: 60, status: "open", created_at: ago(30) },
  ];
  const v = (n: number, s: VideoScript, status: any, score: number, hoursAgo: number, file: string, extra: object = {}) => ({
    id: id(n), version: 1, title: s.title, template: s.template, script: s, caption: `${s.title} — which one are you trying first?`, hashtags: ["studytok", "studytips", "examseason"],
    storage_path: `${id(n)}/${file}`, quality_score: score, critique: critique(score, score < 7 ? ["Hook takes 3s to land", "CTA text is small"] : []), status, created_at: ago(hoursAgo), ...extra,
  });
  m.videos = [
    v(401, scripts.pov, "review", 8.5, 3, "pov.mp4"),
    v(402, scripts.studyHack, "review", 6.4, 4, "studyHack.mp4"),
    v(403, scripts.listicle, "approved", 8.1, 10, "listicle.mp4"),
    v(404, { ...scripts.listicle, title: "3 study hacks (v1)" }, "posted", 7.6, 80, "listicle.mp4"),
    v(405, { ...scripts.pov, title: "POV: group project" }, "posted", 8.8, 60, "pov.mp4"),
    v(406, { ...scripts.studyHack, title: "Blurting method" }, "posted", 7.2, 50, "studyHack.mp4"),
  ];
  for (const x of m.videos) m.files.set(x.storage_path!, x.storage_path!);
  m.posts = [];
  m.metrics = [];
  const stats: Record<number, [number, number, number]> = { 404: [5200, 260, 4], 405: [38000, 3100, 61], 406: [12400, 700, 9] };
  let pid = 500;
  for (const [vid, [views, likes, installs]] of Object.entries(stats)) {
    for (const platform of ["tiktok", "instagram"] as const) {
      const code = id(Number(vid)).replace(/-/g, "").slice(-10);
      const post = { id: id(++pid), video_id: id(Number(vid)), platform, external_id: `${platform}-${vid}`, tracked_link: `https://example.com/download?utm_source=${platform}&utm_content=${code}`, posted_at: ago(48 + (Number(vid) % 3) * 10) };
      m.posts.push(post);
      const f = platform === "tiktok" ? 0.7 : 0.3;
      m.metrics.push({ id: id(++pid + 100), post_id: post.id, snapshot_at: ago(1), views: Math.round(views * f), likes: Math.round(likes * f), comments: Math.round(likes * f * 0.04), shares: Math.round(likes * f * 0.08), saves: Math.round(likes * f * 0.1), avg_watch_sec: platform === "instagram" ? 7.4 : null, installs: Math.round(installs * f), link_clicks: Math.round(installs * f * 6) });
      m.attribution.set(code, { code, clicks: Math.round(installs * 6), installs });
    }
  }
  m.runs = [
    { id: id(601), stage: "research", status: "ok", started_at: ago(20), finished_at: ago(19.9), cost_usd: 0.42, items: 64 },
    { id: id(602), stage: "create", status: "ok", started_at: ago(18), finished_at: ago(17.7), cost_usd: 0.61, items: 3 },
    { id: id(603), stage: "analytics", status: "ok", started_at: ago(5), finished_at: ago(4.95), cost_usd: 0.18, items: 9 },
    { id: id(604), stage: "publish", status: "error", started_at: ago(1), finished_at: ago(0.98), cost_usd: 0, items: 0, error: "HTTP 401 graph.facebook.com: Error validating access token: Session has expired" },
    { id: id(605), stage: "publish", status: "ok", started_at: ago(2), finished_at: ago(1.98), cost_usd: 0, items: 2 },
    { id: id(606), stage: "supervisor", status: "ok", started_at: ago(0.5), finished_at: ago(0.49), cost_usd: 0, items: 1 },
  ];
  m.assets = [{ id: id(701), kind: "app_demo", label: "PDF → flashcards (demo recording)", storage_path: "assets/studyHack.mp4", content_type: "video/mp4", created_at: ago(100) }];
}
