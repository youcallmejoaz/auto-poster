import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { VideoScript } from "./schema";

const here = path.dirname(fileURLToPath(import.meta.url));
let bundled: Promise<string> | null = null;

/** Bundle once per process; reuse for every render. */
const getBundle = (publicDir?: string) =>
  (bundled ??= bundle({ entryPoint: path.join(here, "index.ts"), publicDir }));

export async function renderScript(script: unknown, outFile: string, opts: { publicDir?: string; onProgress?: (p: number) => void } = {}) {
  const parsed = VideoScript.parse(script);
  const serveUrl = await getBundle(opts.publicDir);
  const inputProps = { script: parsed };
  const composition = await selectComposition({ serveUrl, id: "Main", inputProps, browserExecutable: process.env.CHROME_PATH });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation: outFile,
    chromiumOptions: { gl: "swangle" },
    browserExecutable: process.env.CHROME_PATH,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
  return { outFile, durationInFrames: composition.durationInFrames, fps: composition.fps };
}

/** Grab still frames (e.g. for LLM self-critique). */
export async function renderStills(script: unknown, frames: number[], outDir: string) {
  const { renderStill } = await import("@remotion/renderer");
  const parsed = VideoScript.parse(script);
  const serveUrl = await getBundle();
  const inputProps = { script: parsed };
  const composition = await selectComposition({ serveUrl, id: "Main", inputProps, browserExecutable: process.env.CHROME_PATH });
  const out: string[] = [];
  for (const f of frames) {
    const file = path.join(outDir, `frame-${f}.png`);
    await renderStill({ serveUrl, composition, inputProps, frame: Math.min(f, composition.durationInFrames - 1), output: file, browserExecutable: process.env.CHROME_PATH });
    out.push(file);
  }
  return out;
}
