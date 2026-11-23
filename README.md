# StudyShorts

An automated short-video pipeline for a study app, with a web dashboard. It researches what performs in the niche, writes and renders 9:16 videos, posts them to TikTok and Instagram Reels, measures results (including installs), and feeds those results back into the next batch. A supervisor watches the whole thing. You run it from the dashboard.

```
research ──► briefs ──► create (script → voice → render → AI critique loop) ──► review (dashboard)
   ▲                                                                              │ approve
   │                                                                              ▼
analytics ◄── metrics + installs ◄── /go bio link ◄────────── posts ◄──────── publish
   └──► feedback briefs (variants / recuts) ──► create          supervisor watches every stage
```

## What's in the repo

```
dashboard/  Next.js web app: review, library, briefs, research, analytics, media, settings
worker/     The pipeline stages + CLI (research, create, publish, analytics, supervisor)
renderer/   Remotion video templates: listicle, pov, studyHack, appDemo
supabase/   SQL migrations
.github/    Scheduled workflow that runs each stage (and the dashboard's Run buttons)
```

## The dashboard

| Page | What you do there |
|---|---|
| **Overview** | Health (stalled or failed stages, spend against budget, review backlog), a setup checklist, recent runs, and **Run now** buttons for each stage. |
| **Review** | Watch each new video and read the AI critic's notes and the script. Edit the caption and hashtags, then **Approve**, **Request edit** (queues a new version), or **Reject** (optionally queues a recut with your note). |
| **Library** | Every video by status, with a detail page showing posts, per-platform metrics, tracked links and the version history. |
| **Briefs** | Queue your own video ideas, and see what research and analytics queued. Drop briefs you don't want. |
| **Research** | Winning niche patterns, plus the top posts ranked by outperformance against follower count. |
| **Analytics** | Score per video and per template, installs per 1k views, your link-in-bio URLs, and **install import** (paste a CSV/JSON export from Branch, AppsFlyer or App Store Connect). |
| **Media** | Upload app screen recordings, screenshots and b-roll. Files go straight from the browser to storage. The creator uses them automatically: the **App demo** template puts your recording in a phone frame, and b-roll goes behind the other templates. |
| **Settings** | Enter every API key and setting: app description, brand colours, models, voice, research sources, IG/TikTok tokens, posting times, quality bar, budget and alerts. A **Test connection** button checks each key. |

**How keys are stored:** secrets are encrypted with AES-256-GCM (`SETTINGS_ENCRYPTION_KEY`) before they reach the database. They are never sent back to the browser; you only see a masked value. Settings are validated before saving, so a typo can't break the pipeline. Each stage loads the latest settings when it starts, so nothing needs redeploying.

**Link in bio (`/go`):** set *Dashboard public URL* in Settings, then put `https://<dashboard>/go?p=tiktok` in your TikTok bio and `?p=instagram` in your IG bio. Each visit redirects to the newest video's tracked link and logs the click. That's how installs get tied to specific videos, since links in captions aren't clickable.

Try the dashboard without any setup:

```bash
pnpm install
cd dashboard && DEMO_MODE=true pnpm dev   # http://localhost:3000, sample data
```

## Setup (about 30 minutes)

1. **Supabase:** create a project, then run `supabase/migrations/0001_init.sql` and `0002_dashboard.sql` in the SQL editor.
2. **Generate an encryption key:** `openssl rand -base64 32`.
3. **Deploy the dashboard** to Vercel or Netlify. Set the root directory to `dashboard/` and the build command to `pnpm build`. Add these env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SETTINGS_ENCRYPTION_KEY`, `DASHBOARD_PASSWORD`.
4. **GitHub Actions:** in the repo's Settings → Secrets → Actions, add the same `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SETTINGS_ENCRYPTION_KEY`. The workflow then runs on schedule.
5. **Open the dashboard → Settings** and fill in your keys, then follow the checklist on Overview. For the Run buttons, create a fine-grained GitHub token for this repo with *Actions: read & write* and add it under Automation.

### What you need

| Item | Why | Notes |
|---|---|---|
| Anthropic API key | scripts, critique, research, analytics | ~$0.05–0.30 per video |
| Supabase project | database + video/media storage | free tier is fine to start |
| ElevenLabs key | voiceover + word-by-word captions | optional |
| Apify token | trend research | optional; you can import a CSV with the CLI instead |
| IG Business/Creator account + Meta app (Instagram login) | Reels publishing + insights | connect once; refreshed automatically |
| TikTok developer app | posting + stats | connect once; refreshed automatically. **Apply for the audit now (takes weeks)**; until then posts are private |
| Branch/AppsFlyer/App Store campaign links | installs per video | use it as *Download link* and import installs on Analytics |
| App screen recordings | the App demo template | vertical, 10–40s, no personal data on screen |

## Connecting TikTok and Instagram (tokens refresh automatically)

Use **Settings → Connected accounts → Connect** instead of pasting tokens. After that:

| | Token life | What the pipeline does |
|---|---|---|
| TikTok | access 24h, refresh 365 days (renewed on every refresh) | The `tokens` stage runs every 6h and refreshes when < 12h are left. Publish and analytics also refresh just in time if the token is about to expire. |
| Instagram (Instagram Login) | 60 days | Refreshed when < 30 days are left. |
| Instagram (pasted Facebook token, `EAA…`) | 60 days | Converted once into a **Page token that never expires** (needs the Facebook app ID/secret). |

Refreshed tokens are re-encrypted and saved to Settings. The supervisor alerts you if a refresh fails, a token is about to expire, or the TikTok refresh token itself is within 14 days of expiry (reconnect once a year).

One-time setup per platform:
1. **TikTok:** at developers.tiktok.com, create an app with *Login Kit* + *Content Posting API*. Scopes: `user.info.basic`, `video.publish`, `video.list`. Add the redirect URI shown in the dashboard (`https://<dashboard>/api/oauth/tiktok/callback`). Paste the client key and secret in Settings → TikTok, then click **Connect TikTok**.
2. **Instagram:** at developers.facebook.com, create an app → Instagram → *API setup with Instagram login*. Add the redirect URI (`https://<dashboard>/api/oauth/instagram/callback`). Paste the Instagram app ID and secret in Settings → Instagram, then click **Connect Instagram**. The account must be a Business or Creator account.

Set *Dashboard public URL* first, because the redirect URI must match exactly.

Both portals ask for a **Terms of Service** and a **Privacy Policy** URL. The dashboard serves public ones at `https://<dashboard>/terms` and `https://<dashboard>/privacy`. Set *Operator name* and *Contact email* in Settings → App so they show your details. These are templates for a self-operated tool, not legal advice; if your app already publishes its own policies, use those URLs instead.

## Stages (run by GitHub Actions)

| Stage | Schedule | What it does |
|---|---|---|
| `research` | daily | Pulls niche posts, ranks them by outperformance, extracts patterns, queues briefs. |
| `create` | daily | Turns a brief into a script, voiceover and render. The AI critic scores the frames and the stage revises until the video passes (max N loops). Videos land in Review. |
| `publish` | hourly | Posts approved videos inside your posting times, under the daily cap. |
| `analytics` | 6-hourly | Pulls metrics and installs, scores videos, and queues recut/variant briefs for the winners. |
| `tokens` | every 6h | Refreshes TikTok/Instagram tokens close to expiry and stores them encrypted. |
| `supervisor` | hourly | Checks stage SLAs, failures, spend and backlog. It retries a failed stage once and sends alerts to Slack/Discord. |

## CLI (optional)

```bash
pnpm --filter worker stage <research|create|publish|analytics|supervisor> [--dry-run]
pnpm --filter worker stage brief "POV: group project carry" --template pov
pnpm --filter worker stage list review
```

## Honest limitations

- **Scraping:** Apify actors scrape public data, so treat research as best-effort.
- **No music:** trending sounds can't be added through the posting APIs.
- **Single admin login.** The dashboard has one password, not per-user accounts.

## Tests

```bash
pnpm test        # worker: unit + full-loop tests with fakes
pnpm typecheck   # all packages
pnpm render:sample
```
