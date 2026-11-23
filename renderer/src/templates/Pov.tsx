import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { buildTimeline, type VideoScript } from "../schema";
import { Background, Captions, CtaCard, Voiceover, usePop } from "../components/common";

const Bubble: React.FC<{ text: string; font: string; right?: boolean; accent: string }> = ({ text, font, right, accent }) => {
  const p = usePop();
  return (
    <div style={{ alignSelf: right ? "flex-end" : "flex-start", maxWidth: 820, background: right ? accent : "rgba(255,255,255,0.95)", color: "#111", fontFamily: font, fontWeight: 700, fontSize: 58, lineHeight: 1.2, padding: "34px 44px", borderRadius: 44, transform: `translateY(${(1 - p) * 60}px)`, opacity: p, boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}>
      {text}
    </div>
  );
};

/** "POV: …" — persistent top caption + chat-style bubbles accumulating per beat. */
export const Pov: React.FC<{ script: VideoScript }> = ({ script }) => {
  const frame = useCurrentFrame();
  const { segments } = buildTimeline(script);
  const { accent, font } = script.theme;
  const hook = segments[0];
  const beats = segments.filter((s) => s.kind === "beat");
  const cta = segments[segments.length - 1];
  const visible = beats.filter((b) => frame >= b.from && frame < cta.from).slice(-4);
  const topOpacity = interpolate(frame, [cta.from - 6, cta.from], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Background script={script} />
      <div style={{ position: "absolute", top: 180, width: "100%", textAlign: "center", fontFamily: font, fontWeight: 900, fontSize: 78, color: "#fff", padding: "0 70px", boxSizing: "border-box", opacity: topOpacity, textShadow: "0 6px 20px rgba(0,0,0,.6)" }}>
        {hook.onScreen}
      </div>
      <AbsoluteFill style={{ padding: "520px 70px 0", flexDirection: "column", gap: 34 }}>
        {visible.map((b) => (
          <Sequence key={b.index} from={b.from} layout="none">
            <Bubble text={b.onScreen} font={font} right={b.index % 2 === 1} accent={accent} />
          </Sequence>
        ))}
      </AbsoluteFill>
      <Sequence from={cta.from} durationInFrames={cta.durationInFrames}>
        <AbsoluteFill style={{ background: "rgba(0,0,0,.55)" }} />
        <CtaCard script={script} text={cta.onScreen} />
      </Sequence>
      <Captions words={script.audio?.words ?? []} accent={accent} font={font} />
      <Voiceover script={script} />
    </AbsoluteFill>
  );
};
