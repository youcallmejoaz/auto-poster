import fs from "node:fs";
import path from "node:path";
import { buildTimeline, type VideoScript } from "renderer/schema";
import { runStage, type Ctx } from "../core/context";
import type { Brief, Video } from "../core/types";
import { critique, draftToScript, reviseScript, writeScript, type Critique, type ScriptDraft } from "./script";
import type { Tts } from "./tts";

export interface Renderer {
  render(script: VideoScript, outFile: string): Promise<void>;
  stills(script: VideoScript, frames: number[], outDir: string): Promise<string[]>;
}

/** Real renderer (Remotion). Loaded lazily so tests don't pull in Chromium. */
export const remotionRenderer: Renderer = {
  async render(script, outFile) {
    const { renderScript } = await import("renderer/render");
    await renderScript(script, outFile);
  },
  async stills(script, frames, outDir) {
    const { renderStills } = await import("renderer/render");
    return renderStills(script, frames, outDir);
  },
};

/** Frames worth showing the judge: hook, middle of first beat, CTA. */
export function critiqueFrames(script: VideoScript): number[] {
  const { segments } = buildTimeline(script);
  const hook = segments[0];
  const beat = segments.find((s) => s.kind === "beat") ?? hook;
  const cta = segments[segments.length - 1];
  return [hook.from + Math.min(20, hook.durationInFrames - 1), beat.from + Math.floor(beat.durationInFrames / 2), cta.from + Math.min(40, cta.durationInFrames - 1)];
}

export interface CreateDeps {
  tts: Tts;
  renderer: Renderer;
}

const ASSET_PREFIX = "asset:";

/** Stable pick so retries of the same brief use the same clip. */
function pick<T>(items: T[], seed: string): T | undefined {
  if (!items.length) return undefined;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return items[h % items.length];
}

export function parseBrandColors(s: string): { bg: string; bg2: string; accent: string } | null {
  const parts = s.split(",").map((x) => x.trim()).filter((x) => /^#[0-9a-f]{3,8}$/i.test(x));
  return parts.length === 3 ? { bg: parts[0], bg2: parts[1], accent: parts[2] } : null;
}

/** Applies media assets, brand colours and template fallbacks to a script. Stored scripts keep `asset:` refs. */
export async function decorate(ctx: Ctx, script: VideoScript, seed: string, parent?: Video | null): Promise<VideoScript> {
  const assets = await ctx.repo.listAssets();
  const demos = assets.filter((a) => a.kind === "app_demo");
  const shots = assets.filter((a) => a.kind === "screenshot");
  const broll = assets.filter((a) => a.kind === "broll");
  const out: VideoScript = { ...script };
  const media = pick(demos, seed) ?? pick(shots, seed);
  out.appMedia = parent?.script.appMedia ?? (media ? ASSET_PREFIX + media.storage_path : undefined);
  if (parent?.script.backgroundVideo) out.backgroundVideo = parent.script.backgroundVideo;
  else if (broll.length && script.template !== "appDemo") out.backgroundVideo = ASSET_PREFIX + pick(broll, seed)!.storage_path;
  if (out.template === "appDemo" && !out.appMedia) out.template = "studyHack";
  const brand = parseBrandColors(ctx.cfg.BRAND_COLORS);
  if (brand) out.theme = { ...out.theme, ...brand };
  return out;
}

/** Swaps `asset:` refs for short-lived signed URLs right before rendering. */
export async function resolveAssets(ctx: Ctx, script: VideoScript): Promise<VideoScript> {
  const r = async (s?: string) => (s?.startsWith(ASSET_PREFIX) ? ctx.repo.signedAssetUrl(s.slice(ASSET_PREFIX.length), 6 * 3600) : s);
  return { ...script, appMedia: await r(script.appMedia), backgroundVideo: await r(script.backgroundVideo) };
}

/** Brief -> script -> voiceover -> stills -> critique/revise loop -> final render -> library. */
export async function createOne(ctx: Ctx, deps: CreateDeps, brief: Brief): Promise<Video> {
  const parent = brief.parent_video_id ? await ctx.repo.getVideo(brief.parent_video_id) : null;
  const insights = await ctx.repo.topInsights(8);
  const hasAppDemo = (await ctx.repo.listAssets()).some((a) => a.kind === "app_demo" || a.kind === "screenshot");
  const dir = path.join(ctx.cfg.WORK_DIR, `brief-${brief.id}`);
  fs.mkdirSync(dir, { recursive: true });

  let draft: ScriptDraft = await writeScript(ctx, brief, insights, parent, { hasAppDemo });
  let script = draftToScript(draft, ctx.cfg.APP_NAME);
  let review: Critique | null = null;

  for (let loop = 0; loop <= ctx.cfg.MAX_CRITIQUE_LOOPS; loop++) {
    script = await withVoice(deps.tts, await decorate(ctx, draftToScript(draft, ctx.cfg.APP_NAME), brief.id ?? draft.title, parent));
    const frames = await deps.renderer.stills(await resolveAssets(ctx, script), critiqueFrames(script), dir);
    review = await critique(ctx, draft, frames);
    ctx.log(`[create] brief=${brief.id} loop=${loop} score=${review.score}`);
    if (review.score >= ctx.cfg.QUALITY_THRESHOLD || loop === ctx.cfg.MAX_CRITIQUE_LOOPS) break;
    draft = await reviseScript(ctx, draft, review);
  }

  const passed = (review?.score ?? 0) >= ctx.cfg.QUALITY_THRESHOLD;
  const outFile = path.join(dir, "final.mp4");
  await deps.renderer.render(await resolveAssets(ctx, script), outFile);

  const video = await ctx.repo.insertVideo({
    brief_id: brief.id,
    parent_video_id: parent?.id ?? null,
    version: parent ? parent.version + 1 : 1,
    title: draft.title,
    template: script.template,
    script,
    caption: draft.caption,
    hashtags: draft.hashtags.map((h) => h.replace(/^#/, "")),
    quality_score: review?.score ?? null,
    critique: review,
    // Videos that never reached the bar still go to human review, flagged by their score.
    status: ctx.cfg.AUTO_APPROVE && passed ? "approved" : "review",
  });
  const key = `${video.id}/v${video.version}.mp4`;
  await ctx.repo.updateVideo(video.id!, { storage_path: await ctx.repo.uploadVideo(outFile, key) });
  return { ...video, storage_path: key };
}

async function withVoice(tts: Tts, script: VideoScript): Promise<VideoScript> {
  const segs = [script.hook.narration, ...script.beats.map((b) => b.narration), script.cta.narration];
  const v = await tts.synth(segs);
  return v ? { ...script, audio: { src: v.src, words: v.words, segmentEndsMs: v.segmentEndsMs } } : script;
}

export async function runCreate(ctx: Ctx, deps: CreateDeps) {
  return runStage(ctx, "create", async () => {
    const briefs = await ctx.repo.openBriefs(ctx.cfg.VIDEOS_PER_RUN);
    let made = 0;
    const errors: string[] = [];
    for (const b of briefs) {
      await ctx.repo.setBriefStatus(b.id!, "in_progress");
      try {
        await createOne(ctx, deps, b);
        await ctx.repo.setBriefStatus(b.id!, "done");
        made++;
      } catch (e) {
        // Put it back so the next run retries; supervisor sees the error count.
        await ctx.repo.setBriefStatus(b.id!, "open");
        errors.push(`${b.id}: ${(e as Error).message}`);
      }
    }
    if (briefs.length && !made) throw new Error(`all ${briefs.length} briefs failed: ${errors.join("; ")}`);
    if (errors.length) ctx.log(`[create] partial failures: ${errors.join("; ")}`);
    return { items: made };
  });
}
