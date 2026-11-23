import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { buildTimeline, type VideoScript } from "../schema";
import { Background, BigText, Captions, CtaCard, Phone, ProgressBar, Voiceover, usePop } from "../components/common";

const Callout: React.FC<{ text: string; accent: string; font: string }> = ({ text, accent, font }) => {
  const p = usePop();
  return (
    <div style={{ maxWidth: 900, background: accent, color: "#111", fontFamily: font, fontWeight: 900, fontSize: 60, lineHeight: 1.15, padding: "26px 40px", borderRadius: 32, textAlign: "center", transform: `translateY(${(1 - p) * -40}px) scale(${0.9 + 0.1 * p})`, opacity: p, boxShadow: "0 16px 50px rgba(0,0,0,.35)" }}>
      {text}
    </div>
  );
};

/** Hook, then the app's screen recording in a phone frame with one callout per beat, then CTA. */
export const AppDemo: React.FC<{ script: VideoScript }> = ({ script }) => {
  const { segments, durationInFrames } = buildTimeline(script);
  const { accent, font, text } = script.theme;
  const hook = segments[0];
  const cta = segments[segments.length - 1];
  const beats = segments.filter((s) => s.kind === "beat");
  const demoFrom = hook.from + hook.durationInFrames;
  return (
    <AbsoluteFill>
      <Background script={script} />
      <Sequence from={hook.from} durationInFrames={hook.durationInFrames}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <BigText text={hook.onScreen} color={text} font={font} size={104} />
        </AbsoluteFill>
      </Sequence>
      {script.appMedia && (
        <Sequence from={demoFrom} durationInFrames={cta.from - demoFrom}>
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}>
            <Phone src={script.appMedia} durations={script.mediaDurations} width={640} />
          </AbsoluteFill>
        </Sequence>
      )}
      {beats.map((b) => (
        <Sequence key={b.index} from={b.from} durationInFrames={b.durationInFrames}>
          <AbsoluteFill style={{ alignItems: "center", paddingTop: 150, paddingLeft: 60, paddingRight: 60 }}>
            <Callout text={b.onScreen} accent={accent} font={font} />
          </AbsoluteFill>
        </Sequence>
      ))}
      <Sequence from={cta.from} durationInFrames={cta.durationInFrames}>
        <CtaCard script={script} text={cta.onScreen} />
      </Sequence>
      <Captions words={script.audio?.words ?? []} accent={accent} font={font} />
      <ProgressBar total={durationInFrames} accent={accent} />
      <Voiceover script={script} />
    </AbsoluteFill>
  );
};
