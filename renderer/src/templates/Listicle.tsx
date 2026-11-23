import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { buildTimeline, type VideoScript } from "../schema";
import { Background, BigText, Captions, CtaCard, ProgressBar, Voiceover, usePop } from "../components/common";

const NumberBadge: React.FC<{ n: number; accent: string; font: string }> = ({ n, accent, font }) => {
  const p = usePop();
  return (
    <div style={{ width: 200, height: 200, borderRadius: 100, background: accent, color: "#111", fontFamily: font, fontWeight: 900, fontSize: 120, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotate(${(1 - p) * -90}deg) scale(${p})` }}>
      {n}
    </div>
  );
};

/** "3 study hacks that…" — numbered items, one per beat. */
export const Listicle: React.FC<{ script: VideoScript }> = ({ script }) => {
  const { segments, durationInFrames } = buildTimeline(script);
  const { accent, font, text } = script.theme;
  return (
    <AbsoluteFill>
      <Background script={script} />
      {segments.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.durationInFrames}>
          {s.kind === "hook" && (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <BigText text={s.onScreen} color={text} font={font} size={108} />
            </AbsoluteFill>
          )}
          {s.kind === "beat" && (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 70 }}>
              <NumberBadge n={s.index + 1} accent={accent} font={font} />
              <BigText text={s.onScreen} color={text} font={font} size={86} delay={6} />
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
