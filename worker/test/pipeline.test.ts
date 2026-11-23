import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/env";
import { FakeLlm, type JsonRequest } from "../src/core/llm";
import { MemoryRepo } from "../src/core/memoryRepo";
import type { Ctx } from "../src/core/context";
import { runResearch } from "../src/research/analyze";
import { CsvSource } from "../src/research/sources";
import { runCreate, type Renderer } from "../src/creator/create";
import { NoTts } from "../src/creator/tts";
import { runPublish } from "../src/publisher/publish";
import type { PlatformStats, Publisher } from "../src/publisher/platforms";
import { FileAttribution, runAnalytics } from "../src/analytics/analytics";
import { runSupervisor } from "../src/supervisor/supervisor";

const draft = (title: string) => ({
  title,
  template: "listicle",
  hook_narration: "Three study hacks that work",
  hook_on_screen: "3 study hacks that WORK",
  beats: [{ narration: "Active recall", on_screen: "Active recall" }, { narration: "Spaced repetition", on_screen: "Spaced repetition" }],
  cta_narration: "Try the app",
  cta_on_screen: "Try it free",
  caption: "Which one do you use?",
  hashtags: ["studytok", "#studytips"],
  theme: { bg: "#000000", bg2: "#111111", accent: "#ffcc00" },
});

/** Routes fake LLM responses by the system prompt of each stage. */
function responder(scores: number[]) {
  let critiques = 0;
  let scripts = 0;
  return (req: JsonRequest<any>) => {
    if (req.system.includes("strategist"))
      return {
        insights: [{ pattern: "POV exam panic", hook_type: "pov", format: "pov", topic: "exams", cta_style: "soft", evidence_score: 1.4, example_urls: [] }],
        briefs: [{ instruction: "POV exam tomorrow", template: "pov", priority: 70 }, { instruction: "3 recall hacks", template: "listicle", priority: 60 }],
      };
    if (req.system.includes("You write scripts")) return draft(`Video ${++scripts}`);
    if (req.system.includes("creative director")) {
      const s = scores[Math.min(critiques++, scores.length - 1)];
      return { score: s, hook_score: s, readability_score: 8, issues: s < 7 ? ["hook slow"] : [], revision_instructions: s < 7 ? "tighten hook" : "" };
    }
    if (req.system.includes("performance analyst")) {
      const id = req.prompt.match(/best first:\n.*?id=(\S+)/)![1];
      return {
        summary: "Listicles with recall hooks convert best.",
        briefs: [
          { kind: "recut", parent_video_id: id, instruction: "shorter intro", template: "listicle", priority: 90 },
          { kind: "variant", parent_video_id: id, instruction: "same angle for finals", template: "listicle", priority: 80 },
          { kind: "recut", parent_video_id: "not-a-real-id", instruction: "bogus", template: "pov", priority: 10 },
        ],
        stop_doing: ["long intros"],
      };
    }
    throw new Error(`unexpected prompt: ${req.system.slice(0, 40)}`);
  };
}

const fakeRenderer: Renderer = {
  async render(_s, out) {
    fs.writeFileSync(out, "fake-mp4");
  },
  async stills() {
    return [];
  },
};

class FakePublisher implements Publisher {
  posted: string[] = [];
  stat = new Map<string, PlatformStats>();
  constructor(public platform: "tiktok" | "instagram") {}
  async publish(i: { title: string }) {
    const id = `${this.platform}-${this.posted.length}`;
    this.posted.push(i.title);
    return id;
  }
  async stats(ids: string[]) {
    return new Map(ids.filter((i) => this.stat.has(i)).map((i) => [i, this.stat.get(i)!]));
  }
}

function makeCtx(scores = [8]) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const cfg = loadConfig({ WORK_DIR: work, MAX_CRITIQUE_LOOPS: "2", QUALITY_THRESHOLD: "7", DAILY_POST_CAP: "5" } as any);
  const repo = new MemoryRepo();
  const llm = new FakeLlm(responder(scores));
  const ctx: Ctx = { cfg, repo, llm, dryRun: true, cost: { usd: 0 }, log: () => {} };
  return { ctx, repo, llm, work };
}

describe("full loop: research -> create -> approve -> publish -> analytics -> recut", () => {
  it("closes the feedback loop", async () => {
    const { ctx, repo, work } = makeCtx();
    const csv = path.join(work, "r.csv");
    fs.writeFileSync(csv, "platform,url,views,likes,comments,shares,author_followers,caption\n" + Array.from({ length: 6 }, (_, i) => `tiktok,https://t/${i},${(i + 1) * 10000},${i * 300},20,10,1000,POV: exam tomorrow ${i}`).join("\n"));

    // Research -> insights + briefs
    await runResearch(ctx, [new CsvSource(csv)]);
    expect(repo.research).toHaveLength(6);
    expect(repo.insights[0].evidence_score).toBe(1); // clamped
    expect(repo.briefs.filter((b) => b.origin === "research")).toHaveLength(2);

    // Create -> videos in review queue, briefs done, mp4 "uploaded"
    await runCreate(ctx, { tts: new NoTts(), renderer: fakeRenderer });
    expect(repo.videos).toHaveLength(2);
    expect(repo.videos.every((v) => v.status === "review" && v.storage_path && v.quality_score === 8)).toBe(true);
    expect(repo.videos[0].hashtags).toEqual(["studytok", "studytips"]);
    expect(repo.briefs.every((b) => b.status === "done")).toBe(true);

    // Nothing posts until a human approves
    const tt = new FakePublisher("tiktok");
    const ig = new FakePublisher("instagram");
    await runPublish(ctx, [tt, ig], { force: true });
    expect(tt.posted).toHaveLength(0);

    for (const v of repo.videos) await repo.updateVideo(v.id!, { status: "approved" });
    await runPublish(ctx, [tt, ig], { now: new Date("2026-01-01T03:00:00Z") }); // outside slot
    expect(tt.posted).toHaveLength(0);
    await runPublish(ctx, [tt, ig], { force: true });
    expect(tt.posted).toHaveLength(2);
    expect(ig.posted).toHaveLength(2);
    expect(repo.videos.every((v) => v.status === "posted")).toBe(true);
    expect(repo.posts[0].tracked_link).toContain("utm_content=");

    // Need >=3 videos >24h old for analytics to act: add a third and age everything.
    const [b3] = await repo.insertBriefs([{ origin: "manual", instruction: "third", priority: 50, status: "open" }]);
    await runCreate(ctx, { tts: new NoTts(), renderer: fakeRenderer });
    await repo.updateVideo(repo.videos[2].id!, { status: "approved" });
    await runPublish(ctx, [tt, ig], { force: true });
    expect(repo.briefs.find((b) => b.id === b3.id)!.status).toBe("done");
    for (const p of repo.posts) p.posted_at = new Date(Date.now() - 48 * 36e5).toISOString();

    // Metrics: video 2 converts best on installs.
    const views = [5000, 20000, 8000];
    repo.posts.forEach((p) => {
      const i = repo.videos.findIndex((v) => v.id === p.video_id);
      (p.platform === "tiktok" ? tt : ig).stat.set(p.external_id!, { views: views[i], likes: views[i] / 20, comments: 10, shares: 5, saves: 3 });
    });
    const installs: Record<string, { installs: number }> = {};
    repo.posts.forEach((p) => {
      const code = new URL(p.tracked_link).searchParams.get("utm_content")!;
      installs[code] = { installs: [5, 80, 10][repo.videos.findIndex((v) => v.id === p.video_id)] };
    });
    const attrFile = path.join(work, "installs.json");
    fs.writeFileSync(attrFile, JSON.stringify(installs));

    await runAnalytics(ctx, [tt, ig], new FileAttribution(attrFile));
    expect(repo.metrics).toHaveLength(6);
    const fb = repo.briefs.filter((b) => b.origin === "analytics");
    expect(fb).toHaveLength(3);
    const winner = repo.videos[1].id;
    const recut = fb.find((b) => b.instruction.startsWith("[recut] shorter"))!;
    expect(recut.parent_video_id).toBe(winner); // the top scorer by installs
    expect(fb.find((b) => b.instruction.startsWith("[variant]"))!.parent_video_id).toBeNull();
    expect(fb.find((b) => b.instruction.includes("bogus"))!.parent_video_id).toBeNull(); // hallucinated id dropped

    // Creator consumes the recut brief -> version 2 linked to parent.
    for (const b of fb) if (b !== recut) b.status = "dropped";
    await runCreate(ctx, { tts: new NoTts(), renderer: fakeRenderer });
    const v2 = repo.videos.find((v) => v.parent_video_id === winner)!;
    expect(v2.version).toBe(2);
    expect(v2.storage_path).toMatch(/\/v2\.mp4$/);

    // Every stage logged a run.
    expect(new Set(repo.runs.map((r) => r.stage))).toEqual(new Set(["research", "create", "publish", "analytics"]));
    expect(repo.runs.every((r) => r.status === "ok")).toBe(true);
  });
});

describe("creator quality loop", () => {
  it("revises low-scoring scripts until they pass, then stops", async () => {
    const { ctx, repo, llm } = makeCtx([4, 6, 9]);
    await repo.insertBriefs([{ origin: "manual", instruction: "x", priority: 1, status: "open" }]);
    await runCreate(ctx, { tts: new NoTts(), renderer: fakeRenderer });
    expect(llm.calls.filter((c) => c.system.includes("creative director"))).toHaveLength(3);
    expect(repo.videos[0].quality_score).toBe(9);
  });
  it("caps the loop and still sends low scorers to human review (never auto-approves them)", async () => {
    const { ctx, repo, llm } = makeCtx([3]);
    ctx.cfg.AUTO_APPROVE = true;
    await repo.insertBriefs([{ origin: "manual", instruction: "x", priority: 1, status: "open" }]);
    await runCreate(ctx, { tts: new NoTts(), renderer: fakeRenderer });
    expect(llm.calls.filter((c) => c.system.includes("creative director"))).toHaveLength(3);
    expect(repo.videos[0].status).toBe("review");
  });
  it("re-opens the brief when creation fails, and records the error", async () => {
    const { ctx, repo } = makeCtx();
    await repo.insertBriefs([{ origin: "manual", instruction: "x", priority: 1, status: "open" }]);
    const broken: Renderer = { ...fakeRenderer, render: async () => { throw new Error("chromium crashed"); } };
    await expect(runCreate(ctx, { tts: new NoTts(), renderer: broken })).rejects.toThrow(/chromium crashed/);
    expect(repo.briefs[0].status).toBe("open");
    expect(repo.runs[0]).toMatchObject({ stage: "create", status: "error" });
  });
});

describe("supervisor", () => {
  it("alerts and retries a failed stage once", async () => {
    const { ctx, repo } = makeCtx();
    const logs: string[] = [];
    ctx.log = (...m) => logs.push(m.join(" "));
    for (const s of ["research", "publish", "analytics", "tokens"]) await repo.finishRun((await repo.startRun(s)).id!, { status: "ok" });
    await repo.finishRun((await repo.startRun("create")).id!, { status: "error", error: "boom" });
    const retried: string[] = [];
    await runSupervisor(ctx, async (s) => { retried.push(s); });
    expect(retried).toEqual(["create"]);
    expect(logs.join("\n")).toMatch(/last create run failed: boom/);
  });
});
