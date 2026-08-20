import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { theme, beat } from "./theme";
import timing from "./timing.json";
import { Grade, Grain, Vignette, Scanlines } from "./components/Layers";
import { Cold } from "./scenes/l/Cold";
import { Skyline } from "./scenes/l/Skyline";
import { Economy } from "./scenes/l/Economy";
import { Crews } from "./scenes/l/Crews";
import { Storm } from "./scenes/l/Storm";
import { Collection } from "./scenes/l/Collection";
import { Identity } from "./scenes/l/Identity";
import { Door } from "./scenes/l/Door";
import { VaultScene } from "./scenes/l/VaultScene";
import { Events } from "./scenes/l/Events";
import { CTA } from "./scenes/l/CTA";

/**
 * The landscape cut — 1920x1080, ~39 seconds, every mechanic.
 *
 * Structured as a build and a drop rather than a feature list. Nine scenes
 * climb: the city, then the three things you do in it, then crews, then storms,
 * then who you are — and each one raises the music a step. The tenth is The
 * Vault, and the soundtrack opens up on the cut into it, because that is the
 * scene people are meant to talk about.
 *
 * Every cut lands on a beat: scene lengths in `timing.json` are whole numbers of
 * beats at 128 BPM, and the audio script reads the same file, so the edit and
 * the arrangement cannot drift apart.
 */

const FPS = timing.fps;
const CUT = timing.cuts.landscape;
const B = beat(FPS, CUT.bpm); // 14.063 frames at 128 BPM

const SCENE_COMPONENTS = {
  cold: Cold,
  skyline: Skyline,
  economy: Economy,
  crews: Crews,
  storm: Storm,
  collection: Collection,
  identity: Identity,
  door: Door,
  vault: VaultScene,
  events: Events,
  cta: CTA,
} as const;

/**
 * Scene boundaries, rounded ONCE from the running beat total.
 *
 * Rounding each scene's duration separately and summing them lets the error
 * accumulate: at 128 BPM a beat is 14.0625 frames, and by the last scene the cut
 * had drifted 2.25 frames — 75ms — off the music. Rounding the cumulative
 * position instead pins every cut to its beat and lets the durations absorb the
 * fractions.
 */
export const SCENES = (() => {
  const names = Object.keys(CUT.beats) as (keyof typeof SCENE_COMPONENTS)[];
  const beats = CUT.beats as Record<string, number>;
  let cumulative = 0;
  const marks = names.map((name) => {
    const from = Math.round(cumulative * B);
    cumulative += beats[name];
    return { name, from };
  });
  const end = Math.round(cumulative * B);
  return marks.map((m, i) => ({
    name: m.name,
    from: m.from,
    duration: (i + 1 < marks.length ? marks[i + 1].from : end) - m.from,
  }));
})();

export const TOTAL = SCENES.reduce((n, s) => n + s.duration, 0);
const VAULT_AT = SCENES.find((s) => s.name === "vault")!.from;

/** Grade, texture, vignette — above every scene, never inside one. */
const Film: React.FC = () => (
  <>
    <Grade />
    <Scanlines />
    <Grain />
    <Vignette />
  </>
);

export const LandscapePromo: React.FC<{ withAudio?: boolean }> = ({ withAudio = true }) => (
  <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
    {SCENES.map((s) => {
      const Component = SCENE_COMPONENTS[s.name];
      return (
        <Sequence key={s.name} from={s.from} durationInFrames={s.duration} name={s.name}>
          <Component />
        </Sequence>
      );
    })}

    <Film />

    {withAudio && (
      <>
        {/* The game's own club synth, arranged against this edit. */}
        <Audio src={staticFile("sfx/track-landscape.wav")} volume={0.34} />

        {/*
          Hits sit 2 frames BEFORE each cut. Early reads as synced; late reads as
          broken. The cold open needs none — it starts on the downbeat.
        */}
        {SCENES.slice(1).map((s) => (
          <Sequence key={`h${s.name}`} from={Math.max(0, s.from - 2)} durationInFrames={22}>
            <Audio src={staticFile("sfx/hit-landscape.wav")} volume={0.5} />
          </Sequence>
        ))}

        {/*
          One riser, running into The Vault. It is 1.2s long and ducks in its
          final 40ms, so it lifts into the cut and gets out of the way of the
          kick that lands on it.
        */}
        <Sequence
          from={Math.max(0, VAULT_AT - Math.round(1.2 * FPS))}
          durationInFrames={Math.round(1.2 * FPS) + 2}
        >
          <Audio src={staticFile("sfx/riser-landscape.wav")} volume={0.5} />
        </Sequence>
      </>
    )}
  </AbsoluteFill>
);
