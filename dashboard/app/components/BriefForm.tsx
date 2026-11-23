"use client";

import { useActionState, useRef, useEffect } from "react";
import { createBrief } from "../actions";

export function BriefForm() {
  const [state, action, pending] = useActionState(createBrief, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="stack">
      <label className="f">
        What should the video be?
        <textarea name="instruction" placeholder='e.g. "POV: you have 3 exams in one week — show how the app builds a revision plan"' required />
      </label>
      <div className="grid g2">
        <label className="f">
          Template
          <select name="template" defaultValue="">
            <option value="">Let the AI choose</option>
            <option value="listicle">Listicle (numbered tips)</option>
            <option value="pov">POV (chat bubbles)</option>
            <option value="studyHack">Study hack (step cards)</option>
            <option value="appDemo">App demo (screen recording)</option>
          </select>
        </label>
        <label className="f">
          Priority (0–100)
          <input name="priority" type="number" min={0} max={100} defaultValue={80} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Queuing…" : "Queue brief"}</button>
        {state && <span className={`msg ${state.ok ? "ok" : "bad"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
