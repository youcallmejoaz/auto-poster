import fs from "node:fs";
import path from "node:path";
import { runStage, type Ctx } from "../core/context";
import type { Video } from "../core/types";
import { buildCaption, inPostingSlot, trackedLink } from "./links";
import type { Publisher } from "./platforms";

async function localCopy(ctx: Ctx, v: Video): Promise<string> {
  const file = path.join(ctx.cfg.WORK_DIR, "publish", `${v.id}.mp4`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const url = await ctx.repo.signedVideoUrl(v.storage_path!, 3600);
  if (url.startsWith("file://")) fs.copyFileSync(url.slice(7), file);
  else {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`download ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return file;
}

/** Posts approved videos to every configured platform, inside posting slots and under the daily cap. */
export type PublisherSource = Publisher[] | (() => Promise<Publisher[]>);
export const resolvePublishers = async (p: PublisherSource) => (typeof p === "function" ? p() : p);

export async function runPublish(ctx: Ctx, source: PublisherSource, opts: { force?: boolean; now?: Date } = {}) {
  return runStage(ctx, "publish", async () => {
    const now = opts.now ?? new Date();
    if (!opts.force && !inPostingSlot(now, ctx.cfg.POST_SLOTS_UTC)) return { items: 0, reason: "outside posting slot" };
    const publishers = await resolvePublishers(source);
    if (!publishers.length) return { items: 0, reason: "no platforms configured" };

    const today = (await ctx.repo.postsSince(1)).filter((p) => p.posted_at!.slice(0, 10) === now.toISOString().slice(0, 10));
    const postedVideosToday = new Set(today.map((p) => p.video_id)).size;
    const room = ctx.cfg.DAILY_POST_CAP - postedVideosToday;
    if (room <= 0) return { items: 0, reason: "daily cap reached" };

    const queue = (await ctx.repo.videosByStatus("approved", room)).filter((v) => v.storage_path);
    let posted = 0;
    for (const v of queue) {
      const existing = await ctx.repo.postsForVideo(v.id!);
      let ok = true;
      for (const pub of publishers) {
        if (existing.some((p) => p.platform === pub.platform && p.posted_at)) continue;
        try {
          const link = trackedLink(ctx.cfg.APP_LANDING_URL, v.id!, pub.platform);
          const file = await localCopy(ctx, v);
          const mediaUrl = await ctx.repo.signedVideoUrl(v.storage_path!, 3600);
          const caption = buildCaption(v.caption, v.hashtags);
          const externalId = await pub.publish({ mediaUrl, localFile: file, caption, title: caption, videoId: v.id });
          await ctx.repo.insertPost({ video_id: v.id!, platform: pub.platform, external_id: externalId, tracked_link: link, posted_at: new Date().toISOString() });
          posted++;
        } catch (e) {
          ok = false;
          ctx.log(`[publish] ${pub.platform} failed for ${v.id}: ${(e as Error).message}`);
        }
      }
      if (ok) await ctx.repo.updateVideo(v.id!, { status: "posted" });
    }
    return { items: posted };
  });
}
