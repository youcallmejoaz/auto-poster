import { z } from "zod/v4";
import { TEMPLATE_IDS } from "renderer/schema";
import { ask, runStage, type Ctx } from "../core/context";
import type { Brief, Insight, ResearchItem } from "../core/types";
import type { ResearchSource } from "./sources";

/**
 * Outperformance score: how far a post beat its author's audience size, blended with engagement.
 * Normalising by followers stops big accounts dominating just because they're big.
 */
export function researchScore(r: ResearchItem): number {
  const views = Math.max(r.views, 1);
  const engagement = (r.likes + 2 * r.comments + 3 * r.shares) / views; // shares/comments signal intent
  const reach = r.author_followers ? Math.min(views / r.author_followers, 50) : Math.log10(views);
  return Math.log10(views) * 0.4 + Math.log1p(reach) * 0.35 + Math.min(engagement, 0.5) * 2 * 0.25;
}

export function topResearch(items: ResearchItem[], n: number) {
  return [...items].sort((a, b) => researchScore(b) - researchScore(a)).slice(0, n);
}

const InsightsOut = z.object({
  insights: z
    .array(
      z.object({
        pattern: z.string().describe("Specific, reusable creative pattern, e.g. 'POV exam panic -> app saves the day'"),
        hook_type: z.string().describe("question | pov | listicle | bold_claim | relatable_pain | before_after | other"),
        format: z.enum(TEMPLATE_IDS).describe("Closest renderer template we can produce"),
        topic: z.string(),
        cta_style: z.string(),
        evidence_score: z.number().describe("0-1: how strongly the data supports this pattern"),
        example_urls: z.array(z.string()),
      }),
    )
    .describe("5-10 insights, strongest first"),
  briefs: z
    .array(z.object({ instruction: z.string(), template: z.enum(TEMPLATE_IDS), priority: z.number().int() }))
    .describe("3-6 concrete video briefs for our app based on the insights; priority 0-100"),
});

const SYSTEM = `You are a short-form video strategist for a study app. You analyse TikTok/Instagram Reels data from the study niche and find repeatable patterns that drive views AND app installs (not just likes). Be specific and evidence-based; ignore one-off viral flukes and celebrity content. Never suggest copying another creator's video, characters, or audio - extract the underlying pattern only.`;

export async function runResearch(ctx: Ctx, sources: ResearchSource[]) {
  return runStage(ctx, "research", async () => {
    let fetched = 0;
    for (const s of sources) {
      try {
        const items = await s.fetch();
        fetched += await ctx.repo.upsertResearch(items);
        ctx.log(`[research] ${s.name}: ${items.length} items`);
      } catch (e) {
        ctx.log(`[research] source ${s.name} failed: ${(e as Error).message}`);
      }
    }
    const pool = await ctx.repo.recentResearch(30);
    if (pool.length < 5) return { items: fetched, insights: 0, briefs: 0 };

    const top = topResearch(pool, 40);
    const table = top
      .map((r, i) => `${i + 1}. [${r.platform}] views=${r.views} likes=${r.likes} comments=${r.comments} shares=${r.shares} followers=${r.author_followers ?? "?"} dur=${r.duration_sec ?? "?"}s score=${researchScore(r).toFixed(2)}\n   url=${r.url}\n   caption=${JSON.stringify((r.caption ?? "").slice(0, 300))}`)
      .join("\n");
    const out = await ask(ctx, {
      model: ctx.cfg.LLM_MODEL_JUDGE,
      effort: "high",
      system: SYSTEM,
      schema: InsightsOut,
      prompt: `Our app: ${ctx.cfg.APP_NAME} - ${ctx.cfg.APP_DESCRIPTION}.
Templates we can render: listicle (numbered tips), pov (POV caption + chat bubbles), studyHack (hook + step cards).

Top-performing niche posts (last 30 days), ranked by outperformance score:
${table}

Extract the patterns that best explain performance, and propose briefs for our account that naturally feature the app as the solution.`,
    });

    const insights: Insight[] = out.insights.map((i) => ({ ...i, evidence_score: clamp01(i.evidence_score) }));
    await ctx.repo.insertInsights(insights);
    const briefs: Brief[] = out.briefs.map((b) => ({ origin: "research", instruction: b.instruction, template: b.template, priority: clamp(b.priority, 0, 100), status: "open" }));
    await ctx.repo.insertBriefs(briefs);
    return { items: fetched + insights.length + briefs.length, insights: insights.length, briefs: briefs.length };
  });
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const clamp01 = (n: number) => clamp(n, 0, 1);
