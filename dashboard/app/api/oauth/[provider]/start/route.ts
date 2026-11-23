import { NextResponse, type NextRequest } from "next/server";
import { instagramAuthorizeUrl, tiktokAuthorizeUrl } from "worker/tokens";
import { getConfig, requireAuth } from "@/lib/server";
import { STATE_COOKIE, appConfigured, isProvider, randomState, redirectUri } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Sends the browser to TikTok / Instagram to approve access. CSRF-protected with a state cookie. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  await requireAuth();
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse("Unknown provider", { status: 404 });
  const cfg = await getConfig();
  if (!appConfigured(cfg, provider)) {
    return NextResponse.redirect(new URL(`/settings?oauth=error&msg=${encodeURIComponent(`Save the ${provider === "tiktok" ? "TikTok client key and secret" : "Instagram app ID and secret"} first.`)}`, req.url));
  }
  const state = randomState();
  const uri = redirectUri(cfg, provider, req);
  const url = provider === "tiktok" ? tiktokAuthorizeUrl(cfg, uri, state) : instagramAuthorizeUrl(cfg, uri, state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE(provider), state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/oauth", maxAge: 600 });
  return res;
}
