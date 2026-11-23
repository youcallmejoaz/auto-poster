import React from "react";
import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH, VideoScript, buildTimeline, type TemplateId } from "./schema";
import { Listicle } from "./templates/Listicle";
import { Pov } from "./templates/Pov";
import { StudyHack } from "./templates/StudyHack";
import sample from "../fixtures/listicle.json";

const TEMPLATES: Record<TemplateId, React.FC<{ script: VideoScript }>> = { listicle: Listicle, pov: Pov, studyHack: StudyHack };

/** Single entry composition; picks the template from the script props. */
const Main: React.FC<{ script: VideoScript }> = ({ script }) => {
  const parsed = VideoScript.parse(script);
  const T = TEMPLATES[parsed.template];
  return <T script={parsed} />;
};

export const Root: React.FC = () => (
  <Composition
    id="Main"
    component={Main as React.FC<any>}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ script: sample as unknown as VideoScript }}
    calculateMetadata={({ props }) => ({ durationInFrames: buildTimeline(VideoScript.parse((props as any).script)).durationInFrames })}
  />
);
