import { SETTINGS, maskSecret } from "worker/settings";
import { getConfig, getRepo, encKey } from "@/lib/server";
import { INTEGRATIONS, isConfigured } from "@/lib/integrations";
import { ago } from "@/lib/view";
import { SettingsForm, type FieldView } from "../../components/SettingsForm";

export default async function SettingsPage() {
  const repo = getRepo();
  const cfg = await getConfig();
  const stored = new Map((await repo.getSettings()).map((s) => [s.key, s]));
  const fields: FieldView[] = SETTINGS.map((d) => {
    const s = stored.get(d.key);
    const effective = String((cfg as Record<string, unknown>)[d.key] ?? "");
    return {
      ...d,
      // Secrets never leave the server; only a mask and where the value comes from.
      value: d.secret ? "" : s?.value ?? "",
      fromEnv: !s && !!process.env[d.key],
      envValue: d.secret || s ? "" : process.env[d.key] ? `${process.env[d.key]} (from environment)` : effective ? `${effective} (default)` : "",
      secretState: d.secret ? (s ? `Saved ${ago(s.updated_at)}${effective ? ` · ${maskSecret(effective)}` : " · can't decrypt (wrong SETTINGS_ENCRYPTION_KEY?)"}` : effective ? "Set via environment" : "Not set") : undefined,
      checked: d.type === "bool" ? effective === "true" : undefined,
    };
  });
  const integrations = INTEGRATIONS.map((i) => ({ id: i.id, label: i.label, configured: isConfigured(cfg, i.id) }));
  return (
    <div>
      <h1>Settings</h1>
      <p className="sub">Keys are encrypted (AES-256-GCM) before they're stored and are never sent back to the browser. Changes apply on each stage's next run.</p>
      {!encKey() && <div className="msg bad" style={{ marginBottom: 16 }}>SETTINGS_ENCRYPTION_KEY isn't set on the dashboard server, so API keys can't be saved here yet. Non-secret settings still work.</div>}
      <SettingsForm fields={fields} integrations={integrations} canSaveSecrets={!!encKey()} />
    </div>
  );
}
