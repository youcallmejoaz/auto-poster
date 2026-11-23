# StudyShorts

An automated short-video pipeline for a study app. It researches what performs in the niche, writes and renders 9:16 videos, posts them to TikTok and Instagram Reels, measures results (including installs), and feeds those results back into the next batch. A supervisor watches the whole thing.

```
research ──► briefs ──► create (script → voice → render → AI critique loop) ──► review queue
   ▲                                                                              │ approve
   │                                                                              ▼
analytics ◄── metrics + installs ◄────────────── posts ◄──────────────────── publish
   └──► feedback briefs (variants / recuts) ──► create          supervisor watches every stage
```

Each "agent" is a scheduled stage with typed inputs and outputs in Postgres, rather than a free-roaming agent. Claude is called only where judgement is needed: spotting patterns, writing scripts, critiquing frames and reading analytics. This keeps the system debuggable, cheap and testable.

| Stage | Schedule | What it does |
|---|---|---|
| `research` | daily | Pulls niche posts (Apify TikTok/IG scrapers, or a CSV), ranks them by **outperformance vs follower count**, extracts reusable patterns (`insights`), and queues `briefs`. |
| `create` | daily | Brief → script (Sonnet) → ElevenLabs voiceover with word timings → Remotion render. Opus scores the hook, mid and CTA frames against a rubric; below threshold it revises and re-renders (max N loops). Output goes to the library as `review`. |
| `publish` | hourly | Posts `approved` videos inside your posting slots and under a daily cap. Uses the IG Graph API (Reels) and the TikTok Content Posting API. Every post gets a per-video tracked link. |
| `analytics` | 6-hourly | Pulls views, engagement and watch time, plus installs per tracked link. Scores videos by cohort percentile (installs/1k views dominate when available), then asks Opus for **recut / variant / new** briefs. Hallucinated video ids are dropped. |
| `supervisor` | hourly | Checks each stage's SLA, failures, stuck runs, 24h spend against the budget, review backlog and quality trend. It retries a failed stage once (never twice in a row, and never past the budget) and alerts via a Slack/Discord webhook. |

## Layout

```
renderer/   Remotion project: VideoScript schema, 3 templates (listicle, pov, studyHack), render API
worker/     Stages + CLI. src/{core,research,creator,publisher,analytics,supervisor}
supabase/   SQL migration (tables, enums, storage bucket, RLS on)
.github/    Cron workflow that runs each stage
```

## Setup

1. `pnpm install`
2. Create a Supabase project and run `supabase/migrations/0001_init.sql`.
3. `cp .env.example .env` and fill it in (see below for what you need).
4. Try it with no database: `pnpm --filter worker stage brief "3 active recall hacks" --dry-run`
5. For production, add the same values as GitHub Actions secrets/vars. `.github/workflows/pipeline.yml` runs the stages.

Render the sample videos locally with `pnpm render:sample` (outputs to `renderer/out/`). To preview templates live, run `pnpm --filter renderer studio`.

## Daily use (the review loop)

```bash
pnpm --filter worker stage list review                 # ids, scores, 24h preview links
pnpm --filter worker stage approve <videoId>
pnpm --filter worker stage reject <videoId> "hook too slow, cut the first beat"   # queues a recut
pnpm --filter worker stage edit <videoId> "make a finals-week version"           # queues v2
pnpm --filter worker stage brief "POV: group project carry" --template pov --priority 90
```

`AUTO_APPROVE=true` skips human review **only** for videos that pass the quality threshold. Leave it off until you trust the output.

## What you need to provide

| Item | Why | Notes |
|---|---|---|
| Anthropic API key | scripts, critique, analytics | ~$0.05–0.30 per video, depending on loops |
| Supabase project | library, jobs, metrics, video storage | |
| ElevenLabs key | voiceover + synced captions | Optional. Without it, videos are text-only. |
| Apify token | research | Optional. You can import a CSV instead (e.g. a TikTok Creative Center export). |
| IG Business/Creator account + Meta app token | Reels publishing + insights | Scopes: `instagram_content_publish`, insights |
| TikTok developer app | posting + stats | **Apply for the audit now; it takes weeks.** Until then, posts are private (`SELF_ONLY`). |
| Attribution | installs per video | Point `APP_LANDING_URL` at a Branch/AppsFlyer/smart link. Export installs per `utm_content` to `INSTALLS_FILE`. |
| Brand assets | | App screen recording/screenshot (`appMedia`), b-roll (`backgroundVideo`), colours |

## Honest limitations

- **Links in TikTok/IG captions aren't clickable.** Per-video install attribution only works if the tracked link sits in the bio (rotate it to the latest video, or use a link-in-bio page that lists recent videos). Without attribution, analytics optimises for views and engagement and says so in its prompt.
- **Scraping:** Apify actors scrape public data. The ToS risk sits with the vendor, but treat it as best-effort research, not a guaranteed feed.
- **Templates are the creative ceiling.** Three templates ship. More formats (green-screen, app-demo walkthroughs, stitched b-roll) are where future quality gains come from. The schema supports `backgroundVideo` and `appMedia` already.
- **No music.** Trending sounds can't be added through the posting APIs, so add licensed music in the template if you want it.

## Tests

```bash
pnpm test        # unit tests + a full research→create→publish→analytics→recut loop with fakes
pnpm typecheck
```
