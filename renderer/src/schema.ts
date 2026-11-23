import { z } from "zod";

export const TEMPLATE_IDS = ["listicle", "pov", "studyHack", "appDemo"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const WordTiming = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const Beat = z.object({
  /** Spoken voiceover line. */
  narration: z.string().min(1),
  /** Short punchy text shown on screen (defaults to narration). */
  onScreen: z.string().optional(),
  /** Optional explicit duration; otherwise derived from audio timings or word count. */
  durationSec: z.number().positive().optional(),
});
export type Beat = z.infer<typeof Beat>;

export const Theme = z.object({
  bg: z.string().default("#0f172a"),
  bg2: z.string().default("#312e81"),
  accent: z.string().default("#facc15"),
  text: z.string().default("#ffffff"),
  font: z.string().default("Inter, Helvetica, Arial, sans-serif"),
});

export const VideoScript = z.object({
  template: z.enum(TEMPLATE_IDS),
  title: z.string(),
  hook: z.object({ narration: z.string(), onScreen: z.string().optional() }),
  beats: z.array(Beat).min(1).max(8),
  cta: z.object({
    narration: z.string(),
    onScreen: z.string().optional(),
    appName: z.string(),
  }),
  theme: Theme.default({}),
  /** Optional background b-roll video URL/path (rendered muted, darkened). */
  backgroundVideo: z.string().optional(),
  /** Optional app screenshot/screen-recording shown in CTA (image or video URL). */
  appMedia: z.string().optional(),
  /** Source durations (seconds) so clips can loop; filled in by render() when missing. */
  mediaDurations: z.record(z.number()).optional(),
  audio: z
    .object({
      src: z.string(),
      /** Word-level timings for the full voiceover (hook + beats + cta, in order). */
      words: z.array(WordTiming).default([]),
      /** Segment boundaries in ms: [hookEnd, beat1End, ..., ctaEnd]. */
      segmentEndsMs: z.array(z.number()).optional(),
    })
    .optional(),
});
export type VideoScript = z.infer<typeof VideoScript>;

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
const WORDS_PER_SEC = 2.7;
const MIN_SEG_SEC = 1.6;

export type Segment = {
  kind: "hook" | "beat" | "cta";
  index: number;
  narration: string;
  onScreen: string;
  from: number; // frame
  durationInFrames: number;
};

const estimateSec = (s: string) =>
  Math.max(MIN_SEG_SEC, s.trim().split(/\s+/).length / WORDS_PER_SEC + 0.35);

/** Lays out hook, beats and CTA on the timeline. Pure — unit tested. */
export function buildTimeline(script: VideoScript): { segments: Segment[]; durationInFrames: number } {
  const raw = [
    { kind: "hook" as const, index: 0, narration: script.hook.narration, onScreen: script.hook.onScreen ?? script.hook.narration, explicit: undefined as number | undefined },
    ...script.beats.map((b, i) => ({ kind: "beat" as const, index: i, narration: b.narration, onScreen: b.onScreen ?? b.narration, explicit: b.durationSec })),
    { kind: "cta" as const, index: 0, narration: script.cta.narration, onScreen: script.cta.onScreen ?? script.cta.narration, explicit: undefined },
  ];
  const ends = script.audio?.segmentEndsMs;
  const useAudio = ends && ends.length === raw.length;
  let cursor = 0;
  const segments: Segment[] = raw.map((r, i) => {
    let frames: number;
    if (useAudio) {
      const endFrame = Math.round((ends![i] / 1000) * FPS);
      frames = Math.max(1, endFrame - cursor);
    } else {
      frames = Math.round((r.explicit ?? estimateSec(r.narration)) * FPS);
    }
    const seg = { kind: r.kind, index: r.index, narration: r.narration, onScreen: r.onScreen, from: cursor, durationInFrames: frames };
    cursor += frames;
    return seg;
  });
  // Hold the CTA end card a little longer.
  segments[segments.length - 1].durationInFrames += FPS;
  return { segments, durationInFrames: cursor + FPS };
}
