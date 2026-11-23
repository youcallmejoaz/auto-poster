import type { WordTiming } from "renderer/schema";
import { http } from "../core/context";

export interface TtsResult {
  /** data: URI so the renderer can load it without a file server. */
  src: string;
  words: WordTiming[];
  /** End time (ms) of each input segment, in order. */
  segmentEndsMs: number[];
}

export interface Tts {
  synth(segments: string[]): Promise<TtsResult | null>;
}

/** No voiceover: the renderer falls back to word-count timing and no captions. */
export class NoTts implements Tts {
  async synth() {
    return null;
  }
}

export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Turns character-level alignment for `segments.join(" ")` into word timings and segment ends. Pure. */
export function alignmentToTimings(segments: string[], a: CharAlignment): Omit<TtsResult, "src"> {
  const words: WordTiming[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (cur.trim()) words.push({ text: cur.trim(), startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
    cur = "";
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) return flush();
    if (!cur) start = a.character_start_times_seconds[i];
    cur += ch;
    end = a.character_end_times_seconds[i];
  });
  flush();

  // Segment boundaries: character index where each segment ends in the joined string.
  const segmentEndsMs: number[] = [];
  let offset = 0;
  const total = a.characters.length;
  segments.forEach((s, i) => {
    offset += s.length;
    const idx = Math.min(offset - 1, total - 1);
    const t = a.character_end_times_seconds[Math.max(idx, 0)] ?? 0;
    // Small pause after each segment so cuts don't land mid-breath.
    segmentEndsMs.push(Math.round(t * 1000) + (i < segments.length - 1 ? 150 : 400));
    offset += 1; // joining space
  });
  return { words, segmentEndsMs };
}

export class ElevenLabsTts implements Tts {
  constructor(private apiKey: string, private voiceId: string, private model = "eleven_multilingual_v2") {}
  async synth(segments: string[]) {
    const text = segments.join(" ");
    const res = await http<{ audio_base64: string; alignment: CharAlignment }>(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/with-timestamps?output_format=mp3_44100_128`,
      { method: "POST", headers: { "xi-api-key": this.apiKey }, json: { text, model_id: this.model } },
    );
    return { src: `data:audio/mpeg;base64,${res.audio_base64}`, ...alignmentToTimings(segments, res.alignment) };
  }
}
