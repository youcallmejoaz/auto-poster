import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod/v4";

export type Effort = "low" | "medium" | "high";

export interface JsonRequest<S extends z.ZodType> {
  model: string;
  system: string;
  prompt: string;
  schema: S;
  /** Local PNG/JPEG paths to include before the prompt (vision). */
  images?: string[];
  effort?: Effort;
}

export interface Llm {
  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<{ data: z.infer<S>; costUsd: number }>;
}

// $ per 1M tokens [input, output]
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export class LlmRefusalError extends Error {}

export class AnthropicLlm implements Llm {
  private client: Anthropic;
  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async json<S extends z.ZodType>(req: JsonRequest<S>) {
    const images = (req.images ?? []).map((p) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: (p.endsWith(".png") ? "image/png" : "image/jpeg") as "image/png" | "image/jpeg",
        data: fs.readFileSync(p).toString("base64"),
      },
    }));
    const res = await this.client.beta.messages.parse({
      model: req.model,
      max_tokens: 16000,
      system: req.system,
      // Server-side fallback: if the primary model declines, the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
      messages: [{ role: "user", content: [...images, { type: "text", text: req.prompt }] }],
    });
    if (res.stop_reason === "refusal") throw new LlmRefusalError(`LLM refused: ${JSON.stringify(res.stop_details)}`);
    if (res.stop_reason === "max_tokens") throw new Error("LLM output truncated (max_tokens)");
    if (res.parsed_output == null) throw new Error("LLM returned unparseable output");
    const [pin, pout] = PRICES[res.model] ?? PRICES[req.model] ?? [4, 20];
    const u = res.usage;
    const inTok = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
    const costUsd = (inTok * pin + u.output_tokens * pout) / 1e6;
    return { data: req.schema.parse(res.parsed_output) as z.infer<S>, costUsd };
  }
}

/** Deterministic fake for tests and dry runs. */
export class FakeLlm implements Llm {
  calls: JsonRequest<z.ZodType>[] = [];
  constructor(private responder: (req: JsonRequest<z.ZodType>) => unknown) {}
  async json<S extends z.ZodType>(req: JsonRequest<S>) {
    this.calls.push(req);
    return { data: req.schema.parse(this.responder(req)) as z.infer<S>, costUsd: 0 };
  }
}
