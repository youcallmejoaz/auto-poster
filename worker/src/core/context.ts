import type { Config } from "./env";
import type { Llm, JsonRequest } from "./llm";
import type { Repo } from "./repo";
import type { z } from "zod/v4";

export interface Ctx {
  cfg: Config;
  repo: Repo;
  llm: Llm;
  dryRun: boolean;
  /** Accumulates spend for the current stage run. */
  cost: { usd: number };
  log: (...a: unknown[]) => void;
}

/** LLM call that records spend on the context. */
export async function ask<S extends z.ZodType>(ctx: Ctx, req: JsonRequest<S>): Promise<z.infer<S>> {
  const { data, costUsd } = await ctx.llm.json(req);
  ctx.cost.usd += costUsd;
  return data;
}

/** Wraps a stage: records a job_runs row with status, item count, cost and error. */
export async function runStage<T extends { items: number }>(ctx: Ctx, stage: string, fn: () => Promise<T>): Promise<T> {
  const run = await ctx.repo.startRun(stage);
  ctx.cost.usd = 0;
  const t = Date.now();
  try {
    const out = await fn();
    await ctx.repo.finishRun(run.id!, { status: "ok", items: out.items, cost_usd: round(ctx.cost.usd) });
    ctx.log(`[${stage}] ok items=${out.items} cost=$${ctx.cost.usd.toFixed(3)} ${((Date.now() - t) / 1000).toFixed(1)}s`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}`.slice(0, 4000) : String(e);
    await ctx.repo.finishRun(run.id!, { status: "error", error: msg, cost_usd: round(ctx.cost.usd) });
    ctx.log(`[${stage}] ERROR ${msg.split("\n")[0]}`);
    throw e;
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** fetch wrapper with JSON bodies and readable errors. */
export async function http<T = any>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...((rest.headers as Record<string, string>) ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split("?")[0]}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
