import { NextResponse, type NextRequest } from "next/server";
import { linkCode } from "worker/analytics";
import { getConfig, getRepo } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Public link-in-bio: /go?p=tiktok redirects to the newest posted video's tracked link
 * for that platform and records the click, so installs can be tied to a specific video.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("p");
  const platform = p === "tiktok" || p === "instagram" ? p : undefined;
  try {
    const repo = getRepo();
    const post = await repo.latestPost(platform);
    if (post) {
      const code = linkCode(post.tracked_link);
      if (code) await repo.logClick(code, platform ?? null).catch(() => {});
      return NextResponse.redirect(post.tracked_link, 302);
    }
    return NextResponse.redirect((await getConfig()).APP_LANDING_URL, 302);
  } catch {
    const fallback = process.env.APP_LANDING_URL;
    return fallback ? NextResponse.redirect(fallback, 302) : new NextResponse("Not configured", { status: 503 });
  }
}
