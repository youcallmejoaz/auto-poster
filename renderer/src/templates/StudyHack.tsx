import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { buildTimeline, type VideoScript } from "../schema";
import { Background, BigText, Captions, CtaCard, ProgressBar, Voiceover, usePop } from "../components/common";

const StepCard: React.FC<{ step: number; total: number; text: string; accent: string; font: string }> = ({ step, total, text, accent, font }) => {
  const p = usePop();
  return (
    <div style={{ width: 920, background: "rgba(255,255,255,0.08)", border: `4px solid ${accent}`, borderRadius: 48, padding: "60px 56px", transform: `translateX(${(1 - p) * 300}px)`, opacity: p, backdropFilter: "blur(8px)" }}>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 44, color: accent, marginBottom: 24, letterSpacing: 4 }}>STEP {step}/{total}</div>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 74, color: "#fff", lineHeight: 1.15 }}>{text}</div>
    </div>
  );
};

const Emoji: React.FC = () => <div style={{ fontSize: 160, transform: `scale(${usePop()})` }}>🧠</div>;

/** Big hook, then step cards, then CTA. Good for "the 2-minute method that…" content. */
export const StudyHack: React.FC<{ script: VideoScript }> = ({ script }) => {
  const { segments, durationInFrames } = buildTimeline(script);
  const { accent, font, text } = script.theme;
  const total = script.beats.length;
  return (
    <AbsoluteFill>
      <Background script={script} />
      {segments.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.durationInFrames}>
          {s.kind === "hook" && (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 40 }}>
              <Emoji />
              <BigText text={s.onScreen} color={text} font={font} size={100} delay={4} />
            </AbsoluteFill>
          )}
          {s.kind === "beat" && (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <StepCard step={s.index + 1} total={total} text={s.onScreen} accent={accent} font={font} />
            </AbsoluteFill>
          )}
          {s.kind === "cta" && <CtaCard script={script} text={s.onScreen} />}
        </Sequence>
      ))}
      <Captions words={script.audio?.words ?? []} accent={accent} font={font} />
      <ProgressBar total={durationInFrames} accent={accent} />
      <Voiceover script={script} />
    </AbsoluteFill>
  );
};
