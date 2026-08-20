import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, staticFile } from "remotion";
import { theme, beat } from "./theme";
import timing from "./timing.json";
import { Grade, Grain, Vignette, Scanlines } from "./components/Layers";
import { Hook } from "./scenes/Hook";
import { Skyline } from "./scenes/Skyline";
import { Oracle } from "./scenes/Oracle";
import { Live } from "./scenes/Live";
import { CTA } from "./scenes/CTA";
import { LandscapePromo, TOTAL as LANDSCAPE_TOTAL } from "./Landscape";
import { CollectionImage } from "./CollectionImage";

/**
 * 18 seconds, 9:16, 30fps.
 *
 * Short on purpose. This is feed b-roll: it autoplays muted while somebody is
 * scrolling, so it has to state the mechanism in the first second and be over
 * before the thumb moves. Every cut lands on a beat of the soundtrack —
 * `beat(fps)` is fps*60/BPM, and the scene lengths below are whole numbers of
 * beats, which is why the edit feels locked to the music rather than near it.
 */

/**
 * Timing lives in `timing.json` because two things need it: this file, and the
 * offline audio renderer, which is a plain .mjs script and cannot import TS.
 * They were briefly separate copies and immediately drifted — a scene length
 * changed here and the soundtrack kept the old duration, so the last beat fell
 * past the end of the video.
 *
 * On the CTA being 7 beats rather than 5: at 5 it was 73 frames, and its last
 * element — the chain badge — began its entrance on frame 58 and needed ~25
 * frames to settle. It was still fading in when the video ended, and read as a
 * translucent bug rather than a design. A closing scene needs room for its
 * slowest element to land AND a hold afterwards; the hold is the point of a CTA.
 */
const FPS = timing.fps;
const CUT = timing.cuts.vertical;
const B = beat(FPS, CUT.bpm); // 14.516 frames at 124 BPM
const BEATS = CUT.beats;

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
  const names = Object.keys(BEATS) as (keyof typeof BEATS)[];
  let cumulative = 0;
  const marks = names.map((name) => {
    const from = Math.round(cumulative * B);
    cumulative += (BEATS as Record<string, number>)[name];
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

/**
 * The five layers, in order, over whatever the scenes drew.
 *
 * Grade unifies; grain and scanlines add texture; vignette is topmost. All of
 * them are `pointerEvents: none` and none of them are inside a scene, so no
 * scene can accidentally draw above the grade.
 */
const Film: React.FC = () => (
  <>
    <Grade />
    <Scanlines />
    <Grain />
    <Vignette />
  </>
);

const Promo: React.FC<{ withAudio?: boolean }> = ({ withAudio = true }) => (
  <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
    {SCENES.map((s) => (
      <Sequence key={s.name} from={s.from} durationInFrames={s.duration} name={s.name}>
        {s.name === "hook" && <Hook />}
        {s.name === "skyline" && <Skyline />}
        {s.name === "oracle" && <Oracle />}
        {s.name === "live" && <Live />}
        {s.name === "cta" && <CTA />}
      </Sequence>
    ))}

    <Film />

    {withAudio && (
      <>
        {/* The game's own club synth, rendered offline. See scripts/gen-audio.mjs. */}
        <Audio src={staticFile("sfx/track.wav")} volume={0.3} />
        {/* Hits sit 2 frames BEFORE each cut: early reads as synced, late reads
            as broken. The first scene needs no riser — it opens on the downbeat. */}
        {SCENES.slice(1).map((s) => (
          <Sequence key={`h${s.name}`} from={Math.max(0, s.from - 2)} durationInFrames={22}>
            <Audio src={staticFile("sfx/hit.wav")} volume={0.5} />
          </Sequence>
        ))}
      </>
    )}
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="QuantoPromo"
      component={Promo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ withAudio: true }}
    />
    {/* Square cut for feeds that letterbox 9:16. Same scenes, same timing. */}
    <Composition
      id="QuantoPromoSquare"
      component={Promo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{ withAudio: true }}
    />
    {/*
      The long cut. Different scenes, different tempo, its own soundtrack — this
      is not the vertical video letterboxed. Landscape is what makes the
      side-by-side mechanic cards and the lateral pans possible at all.
    */}
    <Composition
      id="QuantoLandscape"
      component={LandscapePromo}
      durationInFrames={LANDSCAPE_TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ withAudio: true }}
    />
    {/*
      The collection image for the OpenSea drop. Square, silent, and exactly
      one loop long — rendered to a GIF by scripts/make-collection-gif.sh.
    */}
    <Composition
      id="CollectionImage"
      component={CollectionImage}
      durationInFrames={72}
      fps={24}
      width={1000}
      height={1000}
    />
  </>
);
