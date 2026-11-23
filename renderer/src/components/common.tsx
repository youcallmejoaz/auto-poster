import React from "react";
import { AbsoluteFill, Audio, Loop, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile } from "remotion";
import type { VideoScript, WordTiming } from "../schema";

export const resolveSrc = (s: string) => (/^(https?:|data:|file:)/.test(s) ? s : staticFile(s));

export const Background: React.FC<{ script: VideoScript }> = ({ script }) => {
  const frame = useCurrentFrame();
  const { bg, bg2 } = script.theme;
  const angle = 160 + Math.sin(frame / 45) * 20;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${bg} 0%, ${bg2} 100%)` }}>
      {script.backgroundVideo ? (
        <>
          <LoopedVideo src={script.backgroundVideo} durations={script.mediaDurations} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: "rgba(0,0,0,0.45)" }} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export const Voiceover: React.FC<{ script: VideoScript }> = ({ script }) =>
  script.audio ? <Audio src={resolveSrc(script.audio.src)} /> : null;

/** Pop-in animation helper. */
export const usePop = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 160 } });
};

export const BigText: React.FC<{ text: string; color: string; font: string; size?: number; highlight?: string; delay?: number }> = ({ text, color, font, size = 96, highlight, delay = 0 }) => {
  const p = usePop(delay);
  return (
    <div
      style={{
        fontFamily: font,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.08,
        color,
        textAlign: "center",
        padding: "0 70px",
        transform: `scale(${0.7 + 0.3 * p})`,
        opacity: p,
        textShadow: "0 6px 24px rgba(0,0,0,0.45)",
        WebkitTextStroke: highlight ? undefined : "0px",
      }}
    >
      {text}
    </div>
  );
};

/** Word-by-word captions synced to TTS timings (TikTok-style). Falls back to nothing without timings. */
export const Captions: React.FC<{ words: WordTiming[]; accent: string; font: string }> = ({ words, accent, font }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  if (!words.length) return null;
  const idx = words.findIndex((w) => ms >= w.startMs && ms < w.endMs + 120);
  if (idx < 0) return null;
  const start = Math.floor(idx / 3) * 3;
  const chunk = words.slice(start, start + 3);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 380 }}>
      <div style={{ fontFamily: font, fontWeight: 900, fontSize: 72, textTransform: "uppercase", textAlign: "center", padding: "0 60px" }}>
        {chunk.map((w, i) => (
          <span key={i} style={{ color: start + i === idx ? accent : "#fff", margin: "0 10px", textShadow: "0 4px 0 #000, 0 0 18px rgba(0,0,0,.8)" }}>
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const ProgressBar: React.FC<{ total: number; accent: string }> = ({ total, accent }) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [0, total], [0, 100], { extrapolateRight: "clamp" });
  return <div style={{ position: "absolute", top: 0, left: 0, height: 14, width: `${w}%`, background: accent }} />;
};

export const CtaCard: React.FC<{ script: VideoScript; text: string }> = ({ script, text }) => {
  const p = usePop(4);
  const { accent, font, text: color } = script.theme;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 50, flexDirection: "column" }}>
      {script.appMedia ? (
        isVideoSrc(script.appMedia) ? (
          <LoopedVideo src={script.appMedia} durations={script.mediaDurations} style={{ width: 520, borderRadius: 48, boxShadow: "0 30px 80px rgba(0,0,0,.5)", transform: `scale(${p})` }} />
        ) : (
          <img src={resolveSrc(script.appMedia)} style={{ width: 520, borderRadius: 48, boxShadow: "0 30px 80px rgba(0,0,0,.5)", transform: `scale(${p})` }} />
        )
      ) : (
        <div style={{ width: 260, height: 260, borderRadius: 60, background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 140, transform: `scale(${p})`, boxShadow: "0 30px 80px rgba(0,0,0,.4)" }}>📚</div>
      )}
      <BigText text={text} color={color} font={font} size={84} delay={8} />
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 56, color: "#111", background: accent, padding: "22px 54px", borderRadius: 999, opacity: usePop(16) }}>
        {script.cta.appName} — link in bio
      </div>
    </AbsoluteFill>
  );
};

export const isVideoSrc = (s: string) => /\.(mp4|mov|webm)(\?|$)/i.test(s) || s.startsWith("data:video");

/** Phone mockup showing an app screen recording or screenshot. */
export const Phone: React.FC<{ src: string; durations?: Record<string, number>; width?: number; scale?: number }> = ({ src, durations, width = 620, scale = 1 }) => (
  <div style={{ width, aspectRatio: "9 / 19.5", borderRadius: 72, padding: 18, background: "#0b0b0f", boxShadow: "0 40px 120px rgba(0,0,0,.55), inset 0 0 0 3px #2a2a33", transform: `scale(${scale})` }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 56, overflow: "hidden", background: "#000" }}>
      {isVideoSrc(src) ? <LoopedVideo src={src} durations={durations} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={resolveSrc(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
    </div>
  </div>
);

/**
 * OffthreadVideo (frame-accurate, decodes H.264 outside the browser) looped to cover the scene.
 * Needs the clip's duration, which render() probes up front.
 */
export const LoopedVideo: React.FC<{ src: string; durations?: Record<string, number>; style: React.CSSProperties }> = ({ src, durations, style }) => {
  const { fps } = useVideoConfig();
  const sec = durations?.[src];
  const video = <OffthreadVideo src={resolveSrc(src)} muted style={style} />;
  return sec ? <Loop durationInFrames={Math.max(1, Math.floor(sec * fps))}>{video}</Loop> : video;
};
