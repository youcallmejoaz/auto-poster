import { describe, expect, it } from "vitest";
import { buildTimeline, FPS, VideoScript } from "renderer/schema";
import { alignmentToTimings } from "../src/creator/tts";
import { mapTikTok, parseCsv, parseResearchCsv } from "../src/research/sources";
import { researchScore, topResearch } from "../src/research/analyze";
import { buildCaption, inPostingSlot, trackedLink } from "../src/publisher/links";
import { scoreVideos } from "../src/analytics/analytics";
import { checkHealth } from "../src/supervisor/supervisor";
import type { JobRun, Video } from "../src/core/types";
import listicle from "../../renderer/fixtures/listicle.json";

const script = VideoScript.parse(listicle);

describe("renderer timeline", () => {
  it("lays out hook, beats, cta contiguously with a held end card", () => {
    const { segments, durationInFrames } = buildTimeline(script);
    expect(segments.map((s) => s.kind)).toEqual(["hook", "beat", "beat", "beat", "cta"]);
    for (let i = 1; i < segments.length; i++) expect(segments[i].from).toBe(segments[i - 1].from + segments[i - 1].durationInFrames - (i === segments.length ? FPS : 0));
    expect(durationInFrames / FPS).toBeGreaterThan(10);
    expect(durationInFrames / FPS).toBeLessThan(40);
  });
  it("uses audio segment ends when present", () => {
    const s = { ...script, audio: { src: "x.mp3", words: [], segmentEndsMs: [2000, 5000, 8000, 11000, 14000] } };
    const { segments } = buildTimeline(s);
    expect(segments[0].durationInFrames).toBe(60);
    expect(segments[1].from).toBe(60);
    expect(segments[4].from).toBe(330);
  });
});

describe("tts alignment", () => {
  it("builds word timings and segment ends from character alignment", () => {
    const segs = ["Hi there.", "Go now."];
    const chars = segs.join(" ").split("");
    const start = chars.map((_, i) => i * 0.1);
    const end = chars.map((_, i) => i * 0.1 + 0.1);
    const r = alignmentToTimings(segs, { characters: chars, character_start_times_seconds: start, character_end_times_seconds: end });
    expect(r.words.map((w) => w.text)).toEqual(["Hi", "there.", "Go", "now."]);
    expect(r.words[2].startMs).toBe(1000);
    expect(r.segmentEndsMs[0]).toBe(900 + 150);
    expect(r.segmentEndsMs[1]).toBe(1700 + 400);
  });
});

describe("research", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("maps CSV and Apify TikTok items", () => {
    const items = parseResearchCsv("platform,url,views,likes,comments,shares,author_followers,caption\ntiktok,https://t/1,1000,100,10,5,500,Hook line. rest\n");
    expect(items[0]).toMatchObject({ platform: "tiktok", views: 1000, hook_text: "Hook line." });
    expect(mapTikTok({ webVideoUrl: "u", playCount: 5, diggCount: 1, authorMeta: { fans: 10 }, text: "t" })).toMatchObject({ url: "u", views: 5, likes: 1, author_followers: 10 });
  });
  it("ranks small accounts that outperform above big accounts that don't", () => {
    const small = { source: "x", platform: "tiktok" as const, url: "a", views: 200_000, likes: 20_000, comments: 500, shares: 2000, author_followers: 2_000 };
    const big = { ...small, url: "b", views: 250_000, likes: 5_000, comments: 50, shares: 50, author_followers: 2_000_000 };
    expect(researchScore(small)).toBeGreaterThan(researchScore(big));
    expect(topResearch([big, small], 1)[0].url).toBe("a");
  });
});

describe("publishing helpers", () => {
  it("builds tracked links with UTM + App Store campaign token", () => {
    const u = new URL(trackedLink("https://app.example/dl", "1234abcd-0000-1111", "tiktok"));
    expect(u.searchParams.get("utm_source")).toBe("tiktok");
    expect(u.searchParams.get("utm_content")).toBe("1234abcd00");
    expect(u.searchParams.get("ct")).toBe("ss_1234abcd00");
  });
  it("formats captions", () => {
    expect(buildCaption("Hi", ["a", "#b"])).toBe("Hi\n\n#a #b");
  });
  it("detects posting slots incl. midnight wrap", () => {
    expect(inPostingSlot(new Date("2026-01-01T15:20:00Z"), "15:00")).toBe(true);
    expect(inPostingSlot(new Date("2026-01-01T16:00:00Z"), "15:00")).toBe(false);
    expect(inPostingSlot(new Date("2026-01-01T23:50:00Z"), "00:10")).toBe(true);
  });
});

const vid = (id: string): Video => ({ id, version: 1, title: id, template: "listicle", script, caption: "", hashtags: [], status: "posted" });

describe("analytics scoring", () => {
  const now = Date.parse("2026-01-10T00:00:00Z");
  const row = (id: string, views: number, likes: number, installs: number | null) => ({
    video: vid(id),
    posts: [{ id: `p${id}`, video_id: id, platform: "tiktok" as const, tracked_link: "x", posted_at: "2026-01-08T00:00:00Z" }],
    metrics: [{ post_id: `p${id}`, snapshot_at: "", views, likes, comments: 0, shares: 0, saves: 0, installs }],
  });
  it("ranks by views+engagement without install data", () => {
    const r = scoreVideos([row("a", 1000, 10, null), row("b", 50_000, 5000, null), row("c", 5000, 100, null)], now);
    expect(r.find((x) => x.video.id === "b")!.score).toBe(100);
    expect(r.find((x) => x.video.id === "a")!.score).toBe(0);
    expect(r[0].ageHours).toBe(48);
  });
  it("lets installs per view dominate when attribution exists", () => {
    const r = scoreVideos([row("viral", 100_000, 5000, 10), row("converter", 10_000, 300, 60), row("meh", 5_000, 100, 1)], now);
    const s = Object.fromEntries(r.map((x) => [x.video.id, x.score]));
    expect(s.converter).toBeGreaterThan(s.viral);
  });
});

describe("supervisor health", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  const run = (stage: string, hoursAgo: number, status: JobRun["status"], cost = 0): JobRun => ({ id: `${stage}${hoursAgo}`, stage, status, started_at: new Date(now - hoursAgo * 36e5).toISOString(), cost_usd: cost, items: 1, error: status === "error" ? "boom" : null });
  const healthy = [run("research", 5, "ok"), run("create", 4, "ok"), run("publish", 1, "ok"), run("analytics", 2, "ok")];
  it("is quiet when everything ran", () => {
    expect(checkHealth({ runs: healthy, reviewQueue: [], recentVideos: [], dailyBudgetUsd: 10, now }).issues).toEqual([]);
  });
  it("flags stalled stages, failures (retry once), budget, review backlog", () => {
    const runs = [run("research", 30, "ok"), run("create", 1, "error"), run("create", 3, "ok"), run("publish", 1, "ok", 12), run("analytics", 2, "ok")];
    const old = { ...vid("r"), status: "review" as const, created_at: new Date(now - 72 * 36e5).toISOString() };
    const h = checkHealth({ runs, reviewQueue: [old], recentVideos: [], dailyBudgetUsd: 10, now });
    const msgs = h.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/no successful research/);
    expect(msgs).toMatch(/last create run failed/);
    expect(msgs).toMatch(/exceeds budget/);
    expect(msgs).toMatch(/waiting for review/);
    expect(h.retry).toEqual(["create"]);
  });
  it("does not retry a stage that failed twice in a row", () => {
    const runs = [...healthy, run("create", 0.5, "error"), run("create", 1, "error")];
    expect(checkHealth({ runs, reviewQueue: [], recentVideos: [], dailyBudgetUsd: 10, now }).retry).toEqual([]);
  });
});
