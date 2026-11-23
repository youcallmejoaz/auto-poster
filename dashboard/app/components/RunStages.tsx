"use client";

import { useState, useTransition } from "react";
import { runStage, type ActionResult } from "../actions";

const STAGES = [
  { id: "research", label: "Research" },
  { id: "create", label: "Create videos" },
  { id: "publish", label: "Publish" },
  { id: "analytics", label: "Analytics" },
  { id: "supervisor", label: "Health check" },
] as const;

export function RunStages({ enabled }: { enabled: boolean }) {
  const [res, setRes] = useState<ActionResult>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack">
      <div className="row">
        {STAGES.map((s) => (
          <button key={s.id} className="btn" disabled={!enabled || pending} onClick={() => start(async () => setRes(await runStage(s.id)))}>
            ▶ {s.label}
          </button>
        ))}
      </div>
      {!enabled && <span className="small muted">Add a GitHub repo and token in Settings → Automation to run stages on demand. They still run on schedule.</span>}
      {res && <span className={`msg ${res.ok ? "ok" : "bad"}`}>{res.message}</span>}
    </div>
  );
}
