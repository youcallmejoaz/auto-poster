import { z } from "zod/v4";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const Env = z.object({
  APP_NAME: z.string().default("StudyApp"),
  APP_DESCRIPTION: z.string().default("AI study app that turns notes into flashcards and quizzes"),
  APP_LANDING_URL: z.string().url().default("https://example.com/download"),
  NICHE_HASHTAGS: z.string().default("studytok,studywithme,studytips,examseason,studymotivation"),
  COMPETITOR_ACCOUNTS: z.string().default(""), // comma-separated handles

  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL_BULK: z.string().default("claude-sonnet-5-5"),
  LLM_MODEL_JUDGE: z.string().default("claude-opus-5-5"),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),

  APIFY_TOKEN: z.string().optional(),
  APIFY_TIKTOK_ACTOR: z.string().default("clockworks~tiktok-scraper"),
  APIFY_INSTAGRAM_ACTOR: z.string().default("apify~instagram-reel-scraper"),

  IG_USER_ID: z.string().optional(),
  IG_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v23.0"),

  TIKTOK_ACCESS_TOKEN: z.string().optional(),
  /** Unaudited TikTok apps can only post SELF_ONLY. Switch to PUBLIC_TO_EVERYONE after audit. */
  TIKTOK_PRIVACY: z.string().default("SELF_ONLY"),

  /** JSON file mapping tracked link -> installs, exported from your attribution tool. */
  INSTALLS_FILE: z.string().optional(),

  ALERT_WEBHOOK_URL: z.string().optional(), // Slack/Discord-compatible incoming webhook

  VIDEOS_PER_RUN: z.coerce.number().int().positive().default(3),
  QUALITY_THRESHOLD: z.coerce.number().min(0).max(10).default(7),
  MAX_CRITIQUE_LOOPS: z.coerce.number().int().min(0).default(2),
  AUTO_APPROVE: bool,
  POST_SLOTS_UTC: z.string().default("15:00,20:00"), // HH:MM, UTC
  DAILY_POST_CAP: z.coerce.number().int().positive().default(2),
  DAILY_BUDGET_USD: z.coerce.number().positive().default(10),
  WORK_DIR: z.string().default(".work"),
});

export type Config = z.infer<typeof Env>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => Env.parse(env);
