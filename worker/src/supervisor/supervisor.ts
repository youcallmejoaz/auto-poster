import { http, runStage, type Ctx } from "../core/context";
import { tokenWarnings } from "../publisher/tokens";
import type { JobRun, Video } from "../core/types";

/** Max hours between successful runs before the stage counts as stalled. */
export const EXPECTED_CADENCE_H: Record<string, number> = { research: 26, create: 26, publish: 3, analytics: 8, tokens: 8 };

export interface Issue {
  severity: "warn" | "critical";
  stage?: string;
  message: string;
}

export interface HealthInput {
  runs: JobRun[]; // last 48h
  reviewQueue: Video[];
  recentVideos: Video[]; // last 7 days, for quality trend
  dailyBudgetUsd: number;
  now?: number;
}

/** Pure health check over job history - unit tested. */
export function checkHealth(i: HealthInput): { issues: Issue[]; retry: string[]; spend24h: number } {
  const now = i.now ?? Date.now();
  const issues: Issue[] = [];
  const retry: string[] = [];
  for (const [stage, h] of Object.entries(EXPECTED_CADENCE_H)) {
    const runs = i.runs.filter((r) => r.stage === stage).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const lastOk = runs.find((r) => r.status === "ok");
    if (!lastOk || now - Date.parse(lastOk.started_at) > h * 36e5) issues.push({ severity: "critical", stage, message: `no successful ${stage} run in ${h}h` });
    const last = runs[0];
    if (last?.status === "error") {
      issues.push({ severity: "warn", stage, message: `last ${stage} run failed: ${(last.error ?? "").split("\n")[0]}` });
      // Retry once: only if the previous run wasn't itself a failure (avoid hot loops).
      if (runs[1]?.status !== "error") retry.push(stage);
    }
    const stuck = runs.find((r) => r.status === "running" && now - Date.parse(r.started_at) > 2 * 36e5);
    if (stuck) issues.push({ severity: "warn", stage, message: `${stage} run ${stuck.id} has been running > 2h` });
  }
  const spend24h = i.runs.filter((r) => now - Date.parse(r.started_at) <= 24 * 36e5).reduce((a, r) => a + Number(r.cost_usd || 0), 0);
  if (spend24h > i.dailyBudgetUsd) issues.push({ severity: "critical", message: `spend $${spend24h.toFixed(2)} in 24h exceeds budget $${i.dailyBudgetUsd}` });
  else if (spend24h > i.dailyBudgetUsd * 0.8) issues.push({ severity: "warn", message: `spend at ${Math.round((spend24h / i.dailyBudgetUsd) * 100)}% of daily budget` });

  const oldReview = i.reviewQueue.filter((v) => v.created_at && now - Date.parse(v.created_at) > 48 * 36e5);
  if (oldReview.length) issues.push({ severity: "warn", message: `${oldReview.length} video(s) waiting for review > 48h - publishing will stall` });

  const scores = i.recentVideos.map((v) => v.quality_score).filter((s): s is number => s != null);
  if (scores.length >= 3) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 6) issues.push({ severity: "warn", message: `average quality score ${avg.toFixed(1)} over last ${scores.length} videos` });
  }
  return { issues, retry, spend24h };
}

export async function sendAlert(webhook: string | undefined, text: string, log: (...a: unknown[]) => void) {
  log(text);
  if (!webhook) return;
  // Slack and Discord incoming webhooks accept these keys respectively.
  await http(webhook, { method: "POST", json: { text, content: text.slice(0, 1900) } });
}

export async function runSupervisor(ctx: Ctx, rerun: (stage: string) => Promise<unknown>) {
  return runStage(ctx, "supervisor", async () => {
    const runs = (await ctx.repo.runsSince(48)).filter((r) => r.stage !== "supervisor");
    const reviewQueue = await ctx.repo.videosByStatus("review", 200);
    const recent = [...(await ctx.repo.videosByStatus("approved", 50)), ...(await ctx.repo.videosByStatus("posted", 50)), ...reviewQueue];
    const { issues, retry, spend24h } = checkHealth({ runs, reviewQueue, recentVideos: recent, dailyBudgetUsd: ctx.cfg.DAILY_BUDGET_USD });

    issues.push(...tokenWarnings(ctx.cfg));
    const budgetBlown = issues.some((i) => i.message.includes("exceeds budget"));
    for (const s of retry) {
      if (budgetBlown) break; // never retry into a blown budget
      try {
        await rerun(s);
        issues.push({ severity: "warn", stage: s, message: `${s} retried successfully` });
      } catch (e) {
        issues.push({ severity: "critical", stage: s, message: `${s} retry failed: ${(e as Error).message}` });
      }
    }
    if (issues.length) {
      const lines = issues.map((i) => `${i.severity === "critical" ? "🔴" : "🟡"} ${i.message}`);
      await sendAlert(ctx.cfg.ALERT_WEBHOOK_URL, `StudyShorts supervisor (spend 24h $${spend24h.toFixed(2)}, review queue ${reviewQueue.length}):\n${lines.join("\n")}`, ctx.log);
    }
    return { items: issues.length };
  });
}
