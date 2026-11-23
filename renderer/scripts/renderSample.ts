import fs from "node:fs";
import path from "node:path";
import { renderScript } from "../src/render";

const names = process.argv.slice(2).length ? process.argv.slice(2) : ["listicle", "pov", "studyHack"];
for (const n of names) {
  const script = JSON.parse(fs.readFileSync(path.join("fixtures", `${n}.json`), "utf8"));
  const out = path.resolve("out", `${n}.mp4`);
  const t = Date.now();
  const r = await renderScript(script, out);
  console.log(`${n}: ${out} (${(r.durationInFrames / r.fps).toFixed(1)}s) in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
