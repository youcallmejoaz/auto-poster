import { z } from "zod/v4";
import { TEMPLATE_IDS, VideoScript } from "renderer/schema";
import { ask, type Ctx } from "../core/context";
import type { Brief, Insight, Video } from "../core/types";

/** What the LLM writes. Kept flat/simple for structured outputs; mapped onto VideoScript afterwards. */
export const ScriptDraft = z.object({
  title: z.string(),
  template: z.enum(TEMPLATE_IDS),
  hook_narration: z.string().describe("Spoken hook, <= 12 words, lands in under 2 seconds"),
  hook_on_screen: z.string().describe("On-screen hook text, <= 9 words, may include 1 emoji"),
  beats: z
    .array(z.object({ narration: z.string(), on_screen: z.string().describe("<= 8 words") }))
    .describe("2-5 beats; total video 12-30 seconds"),
  cta_narration: z.string(),
  cta_on_screen: z.string().describe("<= 7 words"),
  caption: z.string().describe("Post caption, 1-2 lines, ends with a question or 'link in bio'"),
  hashtags: z.array(z.string()).describe("4-6 hashtags without #"),
  theme: z.object({ bg: z.string(), bg2: z.string(), accent: z.string() }).describe("Hex colours; high contrast, readable white text"),
});
export type ScriptDraft = z.infer<typeof ScriptDraft>;

export function draftToScript(d: ScriptDraft, appName: string, extras: Partial<VideoScript> = {}): VideoScript {
  return VideoScript.parse({
    template: d.template,
    title: d.title,
    hook: { narration: d.hook_narration, onScreen: d.hook_on_screen },
    beats: d.beats.slice(0, 8).map((b) => ({ narration: b.narration, onScreen: b.on_screen })),
    cta: { narration: d.cta_narration, onScreen: d.cta_on_screen, appName },
    theme: { ...d.theme },
    ...extras,
  });
}

export function scriptToDraft(s: VideoScript, caption = "", hashtags: string[] = []): ScriptDraft {
  return {
    title: s.title,
    template: s.template,
    hook_narration: s.hook.narration,
    hook_on_screen: s.hook.onScreen ?? s.hook.narration,
    beats: s.beats.map((b) => ({ narration: b.narration, on_screen: b.onScreen ?? b.narration })),
    cta_narration: s.cta.narration,
    cta_on_screen: s.cta.onScreen ?? s.cta.narration,
    caption,
    hashtags,
    theme: { bg: s.theme.bg, bg2: s.theme.bg2, accent: s.theme.accent },
  };
}

const SYSTEM = `You write scripts for short vertical videos (TikTok/Reels) for a study app. Goals in order: stop the scroll in the first 2 seconds, deliver one genuinely useful or relatable idea, and make the app the natural next step. Write how students actually talk: casual, specific, no corporate tone, no fake statistics, no claims the app can't back up. Respect the requested template:
- listicle: hook promises N things; each beat is one numbered tip.
- pov: hook is "POV: ..." relatable situation; beats are short chat-style reactions/moments; app appears as the turning point.
- studyHack: hook names the method/result; beats are concrete steps.`;

export async function writeScript(ctx: Ctx, brief: Brief, insights: Insight[], parent?: Video | null): Promise<ScriptDraft> {
  const insightText = insights.map((i) => `- ${i.pattern} (hook: ${i.hook_type}, format: ${i.format}, cta: ${i.cta_style}, evidence ${i.evidence_score.toFixed(2)})`).join("\n");
  const parentText = parent
    ? `\nThis is an EDIT/VARIANT of an existing video. Keep what worked, change what the brief asks.\nExisting script (JSON):\n${JSON.stringify(scriptToDraft(parent.script, parent.caption, parent.hashtags))}\n`
    : "";
  return ask(ctx, {
    model: ctx.cfg.LLM_MODEL_BULK,
    system: SYSTEM,
    schema: ScriptDraft,
    prompt: `App: ${ctx.cfg.APP_NAME} - ${ctx.cfg.APP_DESCRIPTION}
Brief: ${brief.instruction}
Preferred template: ${brief.template ?? parent?.template ?? "choose the best fit"}
${parentText}
Current winning patterns in the niche:
${insightText || "- (no research yet - use proven study-niche hooks)"}

Write the script.`,
  });
}

export const Critique = z.object({
  score: z.number().describe("0-10 overall: would this stop a student's scroll and drive app curiosity?"),
  hook_score: z.number().describe("0-10"),
  readability_score: z.number().describe("0-10: text size, contrast, overlap, clutter in the frames"),
  issues: z.array(z.string()),
  revision_instructions: z.string().describe("Concrete changes to the script if score is below threshold; empty if none"),
});
export type Critique = z.infer<typeof Critique>;

export async function critique(ctx: Ctx, draft: ScriptDraft, frames: string[]): Promise<Critique> {
  return ask(ctx, {
    model: ctx.cfg.LLM_MODEL_JUDGE,
    effort: "medium",
    system: `You are a strict creative director for short-form study content. Judge the script and the rendered frames (hook frame, a mid-video frame, the CTA frame). Penalise: slow or vague hooks, generic advice, more than ~8 words of on-screen text per frame, low contrast, text cut off or overlapping, CTA that feels like an ad, claims that could be false.`,
    schema: Critique,
    images: frames,
    prompt: `Script:\n${JSON.stringify(draft, null, 2)}\n\nScore it and give revision instructions.`,
  });
}

export async function reviseScript(ctx: Ctx, draft: ScriptDraft, c: Critique): Promise<ScriptDraft> {
  return ask(ctx, {
    model: ctx.cfg.LLM_MODEL_BULK,
    system: SYSTEM,
    schema: ScriptDraft,
    prompt: `Revise this script according to the creative director's notes. Keep the same template unless the notes require otherwise.\n\nScript:\n${JSON.stringify(draft, null, 2)}\n\nIssues:\n- ${c.issues.join("\n- ")}\n\nInstructions: ${c.revision_instructions}`,
  });
}
