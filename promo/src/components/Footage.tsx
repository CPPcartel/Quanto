import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

/**
 * Real game footage, as a scene backdrop.
 *
 * These clips are captured from the running client by `scripts/capture.mjs` —
 * an actual browser, driving the actual game, talking to the actual server
 * reading actual Chainlink feeds. Nothing here is a recreation, which is the
 * entire point: a promo that rebuilds its subject in After Effects is showing
 * you a drawing of the product.
 *
 * `OffthreadVideo`, never `<Video>`: Remotion has to seek to an exact frame for
 * every rendered frame, and only the offthread element does that
 * deterministically. A `<Video>` tag renders whatever the browser happens to
 * have decoded, which produces duplicated and skipped frames in the output.
 */

export interface FootageProps {
  /** Base name of a clip in `public/footage`. */
  shot: string;
  /**
   * Where in the clip to start, in frames.
   *
   * Captures open on a settling city and a camera still easing into place, so
   * most shots are better a second in.
   */
  from?: number;
  /** Playback rate. Below 1 stretches short captures over longer scenes. */
  rate?: number;
  /** A slow push, applied on top of whatever the camera did in-game. */
  scaleFrom?: number;
  scaleTo?: number;
  /** Darkens the plate so type stays readable over it. */
  dim?: number;
  style?: React.CSSProperties;
}

export const Footage: React.FC<FootageProps> = ({
  shot,
  from = 0,
  rate = 1,
  scaleFrom = 1.04,
  scaleTo = 1.12,
  dim = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  /**
   * A slow push across the scene.
   *
   * The captured camera moves, but only as fast as a player would move it. A
   * gentle scale on top keeps the shot alive through a five-second hold without
   * making the in-game move look sped up. It also hides the clip's edges when
   * the capture is shorter than the scene and has to loop.
   */
  const scale = interpolate(frame, [0, durationInFrames], [scaleFrom, scaleTo], {
    easing: theme.ease.inOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: theme.colors.bg, ...style }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo
          src={staticFile(`footage/${shot}.mp4`)}
          startFrom={from}
          playbackRate={rate}
          muted
          // The capture is 1920x1080; cover handles the square and vertical cuts.
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      {dim > 0 && (
        <AbsoluteFill style={{ background: theme.colors.bg, opacity: dim }} />
      )}
    </AbsoluteFill>
  );
};

/**
 * A footage plate with the project's grade already on it.
 *
 * The capture comes out of the game's own renderer, which is already graded for
 * the game — a second pass keeps it consistent with the generated scenes it is
 * intercut with, so a cut from footage to a card does not read as a cut between
 * two different videos.
 */
export const GradedFootage: React.FC<FootageProps> = (props) => (
  <AbsoluteFill>
    <Footage {...props} />
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `linear-gradient(180deg, ${theme.colors.bg}cc 0%, transparent 24%, transparent 68%, ${theme.colors.bg}dd 100%)`,
      }}
    />
  </AbsoluteFill>
);
