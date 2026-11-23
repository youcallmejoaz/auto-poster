"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SETTINGS, encryptSecret, settingsToEnv, type StoredSetting } from "worker/settings";
import { loadConfig } from "worker/env";
import { STAGES, dispatchStage, type StageName } from "worker/github";
import { parseCsv } from "worker/csv";
import type { AssetKind, Brief } from "worker/types";
import { TEMPLATE_IDS } from "renderer/schema";
import { getConfig, getRepo, requireAuth, encKey } from "@/lib/server";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, safeEqual } from "@/lib/session";
import { testIntegration, type IntegrationId } from "@/lib/integrations";

export type ActionResult = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------- auth ----------
export async function login(_: ActionResult, f: FormData): Promise<ActionResult> {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return { ok: false, message: "DASHBOARD_PASSWORD is not set on the server." };
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  if (!safeEqual(str(f, "password"), pw)) return { ok: false, message: "Wrong password." };
  (await cookies()).set(SESSION_COOKIE, await createSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  const next = str(f, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- review / library ----------
export async function approveVideo(id: string) {
  await requireAuth();
  await getRepo().updateVideo(id, { status: "approved" });
  revalidatePath("/", "layout");
}

export async function rejectVideo(id: string, f: FormData) {
  await requireAuth();
  const note = str(f, "note");
  const repo = getRepo();
  const v = await repo.getVideo(id);
  if (!v) return;
  await repo.updateVideo(id, { status: "rejected", review_note: note || null });
  if (f.get("recut") === "on") await repo.insertBriefs([{ origin: "rejection", instruction: `Recut "${v.title}": ${note || "improve the hook and pacing"}`, template: v.template, parent_video_id: v.id, priority: 90, status: "open" }]);
  revalidatePath("/", "layout");
}

export async function requestEdit(id: string, f: FormData) {
  await requireAuth();
  const repo = getRepo();
  const v = await repo.getVideo(id);
  if (!v) return;
  await repo.insertBriefs([{ origin: "manual", instruction: `Edit "${v.title}": ${str(f, "note") || "improve it"}`, template: str(f, "template") || v.template, parent_video_id: v.id, priority: 90, status: "open" }]);
  revalidatePath("/", "layout");
}

export async function updateCaption(id: string, f: FormData) {
  await requireAuth();
  const hashtags = str(f, "hashtags").split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean);
  await getRepo().updateVideo(id, { caption: str(f, "caption"), hashtags });
  revalidatePath("/", "layout");
}

export async function setVideoStatus(id: string, status: "approved" | "review" | "rejected") {
  await requireAuth();
  await getRepo().updateVideo(id, { status });
  revalidatePath("/", "layout");
}

// ---------- briefs ----------
export async function createBrief(_: ActionResult, f: FormData): Promise<ActionResult> {
  await requireAuth();
  const instruction = str(f, "instruction");
  if (instruction.length < 5) return { ok: false, message: "Describe the video in a sentence or two." };
  const template = str(f, "template");
  const b: Brief = { origin: "manual", instruction, template: (TEMPLATE_IDS as readonly string[]).includes(template) ? template : null, priority: Math.max(0, Math.min(100, Number(str(f, "priority")) || 80)), status: "open" };
  await getRepo().insertBriefs([b]);
  revalidatePath("/briefs");
  return { ok: true, message: "Brief queued — it'll be made on the next create run." };
}

export async function setBriefStatus(id: string, status: Brief["status"]) {
  await requireAuth();
  await getRepo().setBriefStatus(id, status);
  revalidatePath("/briefs");
}

// ---------- settings ----------
export async function saveSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  await requireAuth();
  const repo = getRepo();
  const key = encKey();
  const current = new Map((await repo.getSettings()).map((s) => [s.key, s]));
  // Build the full change set first, validate the merged result, and only then write.
  const ops: ({ op: "set"; s: StoredSetting; plain: string } | { op: "delete"; key: string })[] = [];
  for (const def of SETTINGS) {
    if (def.secret) {
      if (f.get(`${def.key}__clear`) === "on") {
        if (current.has(def.key)) ops.push({ op: "delete", key: def.key });
        continue;
      }
      const v = str(f, def.key);
      if (!v) continue; // blank = keep the saved value
      if (!key) return { ok: false, message: "SETTINGS_ENCRYPTION_KEY is not set on the server, so keys can't be stored safely." };
      ops.push({ op: "set", s: { key: def.key, value: encryptSecret(v, key), is_secret: true }, plain: v });
    } else {
      if (!f.has(def.key) && def.type !== "bool") continue;
      const v = def.type === "bool" ? (f.get(def.key) === "on" ? "true" : "false") : str(f, def.key);
      const was = current.get(def.key)?.value ?? "";
      if (v === was) continue;
      if (v) ops.push({ op: "set", s: { key: def.key, value: v, is_secret: false }, plain: v });
      else if (current.has(def.key)) ops.push({ op: "delete", key: def.key });
    }
  }
  if (!ops.length) return { ok: true, message: "No changes." };

  const merged = { ...process.env, ...settingsToEnv([...current.values()], key) } as Record<string, string | undefined>;
  for (const o of ops) {
    if (o.op === "set") merged[o.s.key] = o.plain;
    else merged[o.key] = process.env[o.key];
  }
  try {
    loadConfig(merged as NodeJS.ProcessEnv);
  } catch (e) {
    const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    const label = (k: string) => SETTINGS.find((d) => d.key === k)?.label ?? k;
    return { ok: false, message: `Not saved. ${issues ? issues.map((i) => `${label(String(i.path[0]))}: ${i.message}`).join("; ") : (e as Error).message}` };
  }

  for (const o of ops) {
    if (o.op === "set") await repo.setSetting(o.s);
    else await repo.deleteSetting(o.key);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved ${ops.length} change${ops.length === 1 ? "" : "s"}. Stages pick them up on their next run.` };
}

export async function testConnection(id: IntegrationId): Promise<ActionResult> {
  await requireAuth();
  try {
    return { ok: true, message: await testIntegration(await getConfig(), id) };
  } catch (e) {
    return { ok: false, message: (e as Error).message.slice(0, 300) };
  }
}

// ---------- run stages ----------
export async function runStage(stage: StageName): Promise<ActionResult> {
  await requireAuth();
  if (!STAGES.includes(stage)) return { ok: false, message: "Unknown stage" };
  const cfg = await getConfig();
  if (!cfg.GITHUB_REPO || !cfg.GITHUB_TOKEN) return { ok: false, message: "Add GitHub repo + token in Settings → Automation to run stages from here." };
  try {
    await dispatchStage(cfg.GITHUB_REPO, cfg.GITHUB_TOKEN, stage);
    return { ok: true, message: `Started ${stage}. It shows up under Recent runs in a minute or two.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---------- assets ----------
const KINDS: AssetKind[] = ["app_demo", "broll", "screenshot"];

export async function prepareAssetUpload(kind: AssetKind, filename: string, contentType: string): Promise<{ url: string; path: string } | { error: string }> {
  await requireAuth();
  if (!KINDS.includes(kind)) return { error: "Unknown asset type" };
  if (!/^(video\/(mp4|quicktime|webm)|image\/(png|jpeg|webp))$/.test(contentType)) return { error: "Use MP4/MOV/WebM video or PNG/JPEG/WebP images." };
  const safe = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
  const path = `${kind}/${Date.now()}-${safe}`;
  const { url } = await getRepo().createAssetUpload(path);
  if (url.startsWith("memory://")) return { error: "Uploads are disabled in demo mode." };
  return { url, path };
}

export async function finishAssetUpload(kind: AssetKind, label: string, path: string, contentType: string) {
  await requireAuth();
  if (!KINDS.includes(kind) || !path.startsWith(`${kind}/`)) throw new Error("bad asset");
  await getRepo().insertAsset({ kind, label: label || path.split("/").pop()!, storage_path: path, content_type: contentType });
  revalidatePath("/assets");
}

export async function deleteAsset(id: string) {
  await requireAuth();
  await getRepo().deleteAsset(id);
  revalidatePath("/assets");
}

// ---------- attribution ----------
export async function importAttribution(_: ActionResult, f: FormData): Promise<ActionResult> {
  await requireAuth();
  const text = str(f, "data");
  if (!text) return { ok: false, message: "Paste CSV or JSON first." };
  let rows: { code: string; clicks: number; installs: number }[] = [];
  try {
    if (text.startsWith("{")) {
      rows = Object.entries(JSON.parse(text) as Record<string, { clicks?: number; installs?: number }>).map(([code, v]) => ({ code, clicks: Number(v.clicks) || 0, installs: Number(v.installs) || 0 }));
    } else {
      const [head, ...body] = parseCsv(text);
      const h = head.map((x) => x.toLowerCase());
      const ci = h.findIndex((x) => ["code", "utm_content", "campaign", "ct"].includes(x));
      const ii = h.findIndex((x) => x.includes("install"));
      const ki = h.findIndex((x) => x.includes("click"));
      if (ci < 0 || ii < 0) return { ok: false, message: "CSV needs a code/utm_content column and an installs column." };
      rows = body.map((r) => ({ code: r[ci].replace(/^ss_/, ""), installs: Number(r[ii]) || 0, clicks: ki >= 0 ? Number(r[ki]) || 0 : 0 }));
    }
  } catch (e) {
    return { ok: false, message: `Couldn't parse: ${(e as Error).message}` };
  }
  rows = rows.filter((r) => r.code);
  await getRepo().upsertAttribution(rows);
  revalidatePath("/analytics");
  return { ok: true, message: `Imported ${rows.length} rows. The next analytics run uses them.` };
}
