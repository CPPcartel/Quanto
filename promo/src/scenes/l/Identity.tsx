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
import { Img, staticFile } from "remotion";
import { BgMesh, Scrim } from "../../components/Layers";
import { useExit, WordReveal } from "../../components/Motion";
import collection from "../../collection.json";

/**
 * IDENTITY — the collection, and what it does not do.
 *
 * Three tiers, three characters, three grants. The last line is the one that
 * matters most and it is not decoration: no tier pays $BLOCK. Shifts, floors
 * and storms earn exactly the same for a holder and a guest, and saying so on
 * screen is cheaper than saying it a hundred times in a Discord.
 *
 * The art is the collection's own PNGs out of `collection/out/images`, matched
 * to each tier through `src/collection.json`. Earlier this scene drew stand-in
 * sprites; showing the real token is both more convincing and impossible to get
 * subtly wrong, because there is nothing to redraw.
 */

/** The tokens this scene shows, in tier order, from the manifest. */
const HERO_BY_TIER: Record<string, (typeof collection.heroes)[number]> =
  Object.fromEntries(collection.heroes.map((h) => [h.tier.toLowerCase(), h]));

const TIERS = [
  {
    id: "resident",
    label: "Resident",
    supply: "~3,000",
    color: "#8A92A6",
    grants: ["Your traits render on your character", "Founding badge on the boards"],
  },
  {
    id: "landlord",
    label: "Landlord",
    supply: "~300",
    color: "#22E8FF",
    grants: ["Everything a Resident has", "Charter a crew of 50, not 20"],
  },
  {
    id: "penthouse",
    label: "Penthouse",
    supply: "38",
    color: "#FFD166",
    grants: ["The top floor of one named tower", "That floor counts double for control"],
  },
] as const;

export const Identity: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh />
      <Scrim from="bottom" size={0.3} strength={0.7} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: height * 0.09,
        }}
      >
        <WordReveal
          text="Quanto Residents"
          delay={2}
          per={3}
          gap={16}
          hero={["Residents"]}
          style={{
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: 76,
            letterSpacing: "-0.035em",
            color: theme.colors.text,
          }}
        />
        <span
          style={{
            marginTop: 14,
            fontFamily: fontFamilies.mono,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: theme.colors.textDim,
          }}
        >
          3,338 generated on-chain
        </span>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 42,
          flexDirection: "row",
          paddingTop: height * 0.06,
        }}
      >
        {TIERS.map((t, i) => (
          <TierCard key={t.id} {...t} delay={16 + i * 9} />
        ))}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.06,
        }}
      >
        <NoPayoutLine />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TierCard: React.FC<{
  id: string;
  label: string;
  supply: string;
  color: string;
  grants: readonly string[];
  delay: number;
}> = ({ id, label, supply, color, grants, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  // On screen for over two seconds, so it breathes.
  const float = Math.sin((frame + delay * 3) / 30) * 4;

  return (
    <div
      style={{
        width: 440,
        // Equal heights: one card wrapping a line taller than its neighbours
        // makes a deliberate row look accidental.
        minHeight: 540,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        padding: "34px 28px 30px",
        borderRadius: 16,
        background: "rgba(17,19,26,0.94)",
        border: `1px solid ${color}55`,
        boxShadow: `0 40px 90px -30px ${color}`,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [46, float])}px) scale(${interpolate(
          p,
          [0, 1],
          [0.95, 1]
        )})`,
      }}
    >
{/* The actual token for this tier. */}
      {(() => {
        const hero = HERO_BY_TIER[id];
        if (!hero) return null;
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 240,
                height: 240,
                borderRadius: 14,
                overflow: "hidden",
                border: `2px solid ${color}`,
                boxShadow: `0 0 70px -18px ${color}`,
              }}
            >
              <Img
                src={staticFile(hero.file)}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  // Pixel art: nearest-neighbour, never smoothed.
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 19,
                color: theme.colors.textFaint,
              }}
            >
              #{hero.id}
              {hero.tower ? ` · ${hero.tower}` : ""}
            </span>
          </div>
        );
      })()}

      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span
          style={{
            fontFamily: fontFamilies.display,
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: fontFamilies.mono,
            fontSize: 20,
            color: theme.colors.textFaint,
          }}
        >
          {supply}
        </span>
      </div>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 9,
          width: "100%",
        }}
      >
        {grants.map((g) => (
          <li
            key={g}
            style={{
              display: "flex",
              gap: 10,
              fontFamily: fontFamilies.display,
              fontSize: 21,
              fontWeight: 500,
              lineHeight: 1.35,
              color: theme.colors.textDim,
            }}
          >
            <span style={{ color, flex: "none" }}>·</span>
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The disclaimer, given the same weight as everything else on purpose. */
const NoPayoutLine: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 62, fps, config: theme.spring.smooth });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 28px",
        borderRadius: 999,
        background: "rgba(17,19,26,0.96)",
        border: `1px solid ${theme.colors.up}55`,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: theme.colors.up,
          flex: "none",
        }}
      />
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 23,
          fontWeight: 700,
          color: theme.colors.text,
          letterSpacing: "0.02em",
        }}
      >
        No tier pays $BLOCK. Holders and guests earn the same.
      </span>
    </div>
  );
};
