import fs from "node:fs";
import { loadConfig, loadRuntimeConfig, type Config } from "./core/env";
import type { Ctx } from "./core/context";
import { AnthropicLlm } from "./core/llm";
import { MemoryRepo } from "./core/memoryRepo";
import type { Repo } from "./core/repo";
import { SupabaseRepo } from "./core/supabaseRepo";
import { runResearch } from "./research/analyze";
import { ApifySource, CsvSource, type ResearchSource } from "./research/sources";
import { remotionRenderer, runCreate } from "./creator/create";
import { ElevenLabsTts, NoTts } from "./creator/tts";
import { DryRunPublisher, InstagramPublisher, TikTokPublisher, type Publisher } from "./publisher/platforms";
import { runPublish } from "./publisher/publish";
import { DbAttribution, FileAttribution, runAnalytics } from "./analytics/analytics";
import { runSupervisor } from "./supervisor/supervisor";

const USAGE = `Usage: pnpm stage <command> [flags]

Pipeline stages (run on a schedule):
  research [--csv file]       Pull niche posts, extract insights, queue briefs
  create                      Turn open briefs into rendered videos (to review queue)
  publish [--force]           Post approved videos (inside posting slots)
  analytics                   Pull metrics, score videos, queue feedback briefs
  supervisor                  Health/SLA/budget checks, retry failed stages, alert

Library management:
  brief "<instruction>" [--template listicle|pov|studyHack] [--priority 80]
  list [status]               List videos (draft|review|approved|posted|rejected)
  approve <videoId>
  reject <videoId> "<note>"   Rejects and queues a recut brief with your note
  edit <videoId> "<change>"   Queue a new version of a video

Flags:
  --dry-run                   In-memory DB, no posting (still calls the LLM/TTS/renderer)`;

function arg(flag: string) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function makeRepo(cfg: Config, dry: boolean): Repo {
  if (dry) return new MemoryRepo();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or use --dry-run)");
  return new SupabaseRepo(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
}

function publishers(ctx: Ctx): Publisher[] {
  const { cfg } = ctx;
  const out: Publisher[] = [];
  if (cfg.IG_USER_ID && cfg.IG_ACCESS_TOKEN) out.push(ctx.dryRun ? new DryRunPublisher("instagram", ctx.log) : new InstagramPublisher(cfg.IG_USER_ID, cfg.IG_ACCESS_TOKEN, cfg.META_GRAPH_VERSION));
  if (cfg.TIKTOK_ACCESS_TOKEN) out.push(ctx.dryRun ? new DryRunPublisher("tiktok", ctx.log) : new TikTokPublisher(cfg.TIKTOK_ACCESS_TOKEN, cfg.TIKTOK_PRIVACY));
  if (ctx.dryRun && !out.length) out.push(new DryRunPublisher("tiktok", ctx.log), new DryRunPublisher("instagram", ctx.log));
  return out;
}

async function runNamed(ctx: Ctx, stage: string): Promise<unknown> {
  const { cfg } = ctx;
  switch (stage) {
    case "research": {
      const sources: ResearchSource[] = [];
      const csv = arg("--csv");
      if (csv) sources.push(new CsvSource(csv));
      if (cfg.APIFY_TOKEN) sources.push(new ApifySource(cfg));
      if (!sources.length) ctx.log("[research] no sources configured (set APIFY_TOKEN or pass --csv); analysing existing data only");
      return runResearch(ctx, sources);
    }
    case "create":
      return runCreate(ctx, { tts: cfg.ELEVENLABS_API_KEY ? new ElevenLabsTts(cfg.ELEVENLABS_API_KEY, cfg.ELEVENLABS_VOICE_ID) : new NoTts(), renderer: remotionRenderer });
    case "publish":
      return runPublish(ctx, publishers(ctx), { force: process.argv.includes("--force") });
    case "analytics":
      return runAnalytics(ctx, publishers(ctx), cfg.INSTALLS_FILE && fs.existsSync(cfg.INSTALLS_FILE) ? new FileAttribution(cfg.INSTALLS_FILE) : await DbAttribution.load(ctx.repo));
    case "supervisor":
      return runSupervisor(ctx, (s) => runNamed(ctx, s));
    default:
      throw new Error(`unknown stage ${stage}`);
  }
}

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2).filter((x, i, all) => !x.startsWith("--") && !(i > 0 && ["--csv", "--template", "--priority"].includes(all[i - 1])));
  if (!cmd || cmd === "help") return console.log(USAGE);
  const dryRun = process.argv.includes("--dry-run");
  const repo = makeRepo(loadConfig(), dryRun);
  // Settings saved in the dashboard override env vars.
  const cfg = await loadRuntimeConfig(dryRun ? null : repo);
  const ctx: Ctx = { cfg, repo, llm: new AnthropicLlm(cfg.ANTHROPIC_API_KEY), dryRun, cost: { usd: 0 }, log: (...m) => console.log(new Date().toISOString(), ...m) };

  switch (cmd) {
    case "brief": {
      if (!a1) throw new Error("brief needs an instruction");
      const [b] = await ctx.repo.insertBriefs([{ origin: "manual", instruction: a1, template: arg("--template") ?? null, priority: Number(arg("--priority") ?? 80), status: "open" }]);
      return console.log(`queued brief ${b.id}`);
    }
    case "list": {
      const status = (a1 ?? "review") as any;
      for (const v of await ctx.repo.videosByStatus(status)) {
        const preview = v.storage_path ? await ctx.repo.signedVideoUrl(v.storage_path, 24 * 3600) : "(not rendered)";
        console.log(`${v.id}  v${v.version}  score=${v.quality_score ?? "-"}  ${v.template}  ${v.title}\n    ${preview}`);
      }
      return;
    }
    case "approve":
      await ctx.repo.updateVideo(a1, { status: "approved" });
      return console.log("approved");
    case "reject":
    case "edit": {
      const v = await ctx.repo.getVideo(a1);
      if (!v) throw new Error("video not found");
      if (cmd === "reject") await ctx.repo.updateVideo(a1, { status: "rejected", review_note: a2 ?? null });
      await ctx.repo.insertBriefs([{ origin: cmd === "reject" ? "rejection" : "manual", instruction: `Recut "${v.title}": ${a2 ?? "improve it"}`, template: v.template, parent_video_id: v.id, priority: 90, status: "open" }]);
      return console.log("queued recut brief");
    }
    default:
      await runNamed(ctx, cmd);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
