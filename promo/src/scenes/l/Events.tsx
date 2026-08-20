import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../../theme";
import { fontFamilies } from "../../fonts";
import { BgMesh, Scrim } from "../../components/Layers";
import { useExit, WordReveal } from "../../components/Motion";

/**
 * EVENTS — why you would be in there at four in the afternoon.
 *
 * The three events are real, and none of them is on a calendar: they fire off
 * market transitions, straight out of `server/src/game/club.ts`. Closing Bell on
 * the phase flip, Storm Rave when volatility spikes, Season Party on the weekly
 * roll. Durations are the server's own.
 *
 * The banner is shown to everyone, holder or not — a guest seeing "Closing Bell
 * at The Vault, 18 inside" is the entire mechanism.
 */

const EVENTS = [
  {
    id: "closing_bell",
    label: "Closing Bell",
    trigger: "The market closes",
    duration: "20 min",
    color: theme.colors.primary,
  },
  {
    id: "storm_rave",
    label: "Storm Rave",
    trigger: "A volatility storm starts",
    duration: "Runs with the storm",
    color: theme.colors.down,
  },
  {
    id: "season_party",
    label: "Season Party",
    trigger: "The weekly season rolls over",
    duration: "30 min",
    color: theme.colors.accent,
  },
] as const;

export const Events: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh />
      <Scrim from="bottom" size={0.28} strength={0.6} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: height * 0.08,
        }}
      >
        <WordReveal
          text="Events fire off the market, not a calendar"
          delay={2}
          per={2}
          gap={16}
          hero={["market,"]}
          style={{
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: 66,
            letterSpacing: "-0.035em",
            lineHeight: 1.06,
            color: theme.colors.text,
            maxWidth: 1400,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          // Equal heights come from the card's own minHeight, not from
          // `alignItems: stretch` — in a row that would stretch each card to the
          // full 1080 of the frame.
          gap: 38,
          // The cards were small islands in a 1920 frame with the headline a
          // long way above them; this pulls the block up under the title.
          paddingTop: height * 0.09,
        }}
      >
        {EVENTS.map((e, i) => (
          <EventCard key={e.id} {...e} delay={20 + i * 10} live={i === 1} />
        ))}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.07,
        }}
      >
        <Footnote />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EventCard: React.FC<{
  label: string;
  trigger: string;
  duration: string;
  color: string;
  delay: number;
  live: boolean;
}> = ({ label, trigger, duration, color, delay, live }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  const pulse = live ? 0.6 + 0.4 * Math.abs(Math.sin(frame / 9)) : 1;
  const float = Math.sin((frame + delay * 4) / 32) * 4;

  return (
    <div
      style={{
        width: 540,
        minHeight: 330,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "34px 34px 32px",
        borderRadius: 16,
        background: "rgba(17,19,26,0.95)",
        border: `1px solid ${live ? color : `${color}44`}`,
        boxShadow: live
          ? `0 0 60px -14px ${color}, 0 40px 90px -34px rgba(0,0,0,0.9)`
          : "0 40px 90px -34px rgba(0,0,0,0.9)",
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [44, float])}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: fontFamilies.display,
            fontSize: 46,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color,
          }}
        >
          {label}
        </span>
        {live && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: pulse,
            }}
          >
            <span
              style={{ width: 9, height: 9, borderRadius: "50%", background: color, flex: "none" }}
            />
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color,
              }}
            >
              LIVE
            </span>
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
        <Row label="Fires when" value={trigger} />
        <Row label="Runs for" value={duration} />
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span
      style={{
        fontFamily: fontFamilies.mono,
        fontSize: 16,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: theme.colors.textFaint,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: fontFamilies.display,
        fontSize: 27,
        fontWeight: 600,
        color: theme.colors.textDim,
      }}
    >
      {value}
    </span>
  </div>
);

const Footnote: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 62, fps, config: theme.spring.smooth });
  return (
    <span
      style={{
        fontFamily: fontFamilies.mono,
        fontSize: 22,
        fontWeight: 500,
        letterSpacing: "0.06em",
        color: theme.colors.textDim,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [14, 0])}px)`,
      }}
    >
      The banner shows to everyone. Getting in is the part that does not.
    </span>
  );
};
