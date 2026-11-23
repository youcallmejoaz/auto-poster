"use client";

import { useActionState } from "react";
import type { SettingDef } from "worker/settings";
import type { IntegrationId } from "@/lib/integrations";
import { saveSettings, testConnection } from "../actions";
import { ActionButton } from "./ActionButton";

export type FieldView = SettingDef & { value: string; fromEnv: boolean; envValue: string; secretState?: string; checked?: boolean };

const GROUP_HELP: Record<string, string> = {
  App: "What the scripts say about your app, and where viewers go.",
  AI: "Claude writes scripts (script model) and judges, researches and analyses (judge model).",
  Voice: "Voiceover plus word-by-word captions.",
  Research: "Where trend research comes from.",
  Instagram: "Reels publishing and insights via the official Graph API.",
  TikTok: "Content Posting API. Apply for TikTok's app audit early, because it takes weeks.",
  Publishing: "When and how much to post.",
  Ops: "Quality bar, volume and spend limits.",
  Automation: "Lets the Run buttons trigger the GitHub Actions workflow.",
};

const TESTABLE: Record<string, IntegrationId> = { AI: "anthropic", Voice: "elevenlabs", Research: "apify", Instagram: "instagram", TikTok: "tiktok", Automation: "github" };

export function SettingsForm({ fields, integrations, canSaveSecrets }: { fields: FieldView[]; integrations: { id: IntegrationId; label: string; configured: boolean }[]; canSaveSecrets: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <form action={action}>
      {groups.map((g) => {
        const integ = TESTABLE[g] ? integrations.find((i) => i.id === TESTABLE[g]) : undefined;
        return (
          <section key={g} className="settings-group">
            <div className="stack" style={{ gap: 6 }}>
              <h2 style={{ margin: 0 }}>{g}</h2>
              <p className="small muted">{GROUP_HELP[g]}</p>
              {integ && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className={`badge ${integ.configured ? "ok" : ""}`} style={{ alignSelf: "flex-start" }}>{integ.configured ? "Configured" : "Not configured"}</span>
                  {integ.configured && <ActionButton className="btn sm" label="Test connection" pendingLabel="Testing…" run={() => testConnection(integ.id)} />}
                </div>
              )}
            </div>
            <div className="stack" style={{ gap: 14 }}>
              {fields.filter((f) => f.group === g).map((f) => <Field key={f.key} f={f} canSaveSecrets={canSaveSecrets} />)}
            </div>
          </section>
        );
      })}
      <div className="sticky-save row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
        {state && <span className={`msg ${state.ok ? "ok" : "bad"}`}>{state.message}</span>}
        <span className="small muted">Test buttons use the saved values, so save first.</span>
      </div>
    </form>
  );
}

function Field({ f, canSaveSecrets }: { f: FieldView; canSaveSecrets: boolean }) {
  if (f.type === "bool") {
    return (
      <label className="check">
        <input type="checkbox" name={f.key} defaultChecked={f.checked} /> {f.label}
        {f.help && <span className="small muted">— {f.help}</span>}
      </label>
    );
  }
  const placeholder = f.secret ? (f.secretState === "Not set" ? "Paste key" : "Leave blank to keep the current key") : f.envValue || f.placeholder;
  return (
    <label className="f">
      <span className="row between">
        <span>{f.label}</span>
        {f.secret && <span className={`badge ${f.secretState === "Not set" ? "" : "ok"}`}>{f.secretState}</span>}
      </span>
      {f.type === "textarea" ? (
        <textarea name={f.key} defaultValue={f.value} placeholder={placeholder} />
      ) : (
        <input
          name={f.key}
          type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
          step={f.type === "number" ? "any" : undefined}
          defaultValue={f.value}
          placeholder={placeholder}
          autoComplete="off"
          disabled={f.secret && !canSaveSecrets}
        />
      )}
      {f.help && <span className="help">{f.help}</span>}
      {f.secret && f.secretState?.startsWith("Saved") && (
        <label className="check small" style={{ fontWeight: 400 }}><input type="checkbox" name={`${f.key}__clear`} /> Remove saved key</label>
      )}
    </label>
  );
}
