import { NextResponse, type NextRequest } from "next/server";
import { exchangeInstagramCode, exchangeTikTokCode, repoSink } from "worker/tokens";
import { safeEqual } from "@/lib/session";
import { encKey, getConfig, getRepo, requireAuth } from "@/lib/server";
import { STATE_COOKIE, isProvider, redirectUri } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** TikTok / Instagram redirect here with ?code&state. Exchanges the code and stores the tokens encrypted. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  await requireAuth();
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse("Unknown provider", { status: 404 });
  const back = (ok: boolean, msg: string) => {
    const res = NextResponse.redirect(new URL(`/settings?oauth=${ok ? "ok" : "error"}&msg=${encodeURIComponent(msg)}`, req.url));
    res.cookies.delete({ name: STATE_COOKIE(provider), path: "/api/oauth" });
    return res;
  };

  const q = req.nextUrl.searchParams;
  const err = q.get("error_description") || q.get("error_message") || q.get("error");
  if (err) return back(false, `${provider === "tiktok" ? "TikTok" : "Instagram"} declined: ${err}`);
  const code = q.get("code");
  const state = q.get("state") ?? "";
  const expected = req.cookies.get(STATE_COOKIE(provider))?.value ?? "";
  if (!code) return back(false, "No authorization code returned.");
  if (!expected || !safeEqual(state, expected)) return back(false, "Login session expired or didn't match. Please try Connect again.");
  if (!encKey()) return back(false, "SETTINGS_ENCRYPTION_KEY isn't set on the server, so tokens can't be stored.");

  try {
    const cfg = await getConfig();
    const sink = repoSink(getRepo(), encKey(), cfg);
    const uri = redirectUri(cfg, provider, req);
    const msg = provider === "tiktok" ? await exchangeTikTokCode(cfg, code, uri, sink) : await exchangeInstagramCode(cfg, code, uri, sink);
    return back(true, `${msg}. Tokens refresh automatically from now on.`);
  } catch (e) {
    return back(false, `Couldn't finish connecting: ${(e as Error).message.slice(0, 300)}`);
  }
}
