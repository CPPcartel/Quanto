import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../../theme";
import { fontFamilies } from "../../fonts";
import { PLACED } from "../../components/City";
import { Footage } from "../../components/Footage";
import { Panel, StatRow, Bar } from "../../components/Panel";
import { useExit } from "../../components/Motion";

/**
 * ECONOMY — the three ways a player actually plays, in one sustained shot.
 *
 * The camera never cuts. The city stays live on the left and the cards swap on
 * the right, so this reads as one continuous look at a running game rather than
 * three slides. Landscape is the only reason that composition exists.
 *
 * Every number on these cards is the game's real constant, pulled from
 * `server/src/game/economy.ts` and `shifts.ts` — a promo that invents its own
 * numbers is a promo you have to correct later.
 */

/** Sub-beat lengths inside the scene. Sums to the scene's own duration. */
const CARD_FRAMES = 66;

export const Economy: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  return (
    <AbsoluteFill style={{ ...exit }}>
      {/*
        Real footage of the streets, pushed left so the card column sits over the
        quiet side of frame. Slowed to 0.75x: the capture is shorter than the
        scene and a slight slow-motion reads as deliberate where a visible loop
        would not.
      */}
      <Footage shot="street" from={6} rate={0.46} scaleFrom={1.06} scaleTo={1.2} />

      {/* A vertical scrim under the card column, so type never fights towers. */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(270deg, rgba(17,19,26,0.97) 0%, rgba(17,19,26,0.93) 34%, rgba(17,19,26,0) 62%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          right: 88,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Sequence from={0} durationInFrames={CARD_FRAMES} layout="none">
          <OwnCard />
        </Sequence>
        <Sequence from={CARD_FRAMES} durationInFrames={CARD_FRAMES} layout="none">
          <EarnCard />
        </Sequence>
        <Sequence from={CARD_FRAMES * 2} durationInFrames={CARD_FRAMES + 8} layout="none">
          <TradeCard />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

/** A card wrapper that exits faster than it enters, as everything here does. */
const Slot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [CARD_FRAMES - 10, CARD_FRAMES - 2], [1, 0], {
    easing: theme.ease.in,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: "50%",
        transform: `translateY(-50%) translateX(${(1 - out) * -30}px)`,
        opacity: out,
      }}
    >
      {children}
    </div>
  );
};

const OwnCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tower = PLACED.find((t) => t.symbol === "NVDA")!;
  const owned = spring({ frame: frame - 16, fps, config: { damping: 26, stiffness: 60, mass: 1 } });

  return (
    <Slot>
      <Panel
        eyebrow="Own"
        title="Lease a floor in any tower"
        body="Your floor pays out while the tower stands. Height is the price, so a tower that runs pays a floor that costs less than the one beside it."
        accent={theme.colors.district.tech}
      >
        <StatRow
          delay={12}
          items={[
            { label: "Tower", value: tower.symbol },
            { label: "Floors held", value: Math.round(owned * 4).toString(), accent: theme.colors.primary },
            { label: "Paid in", value: "$BLOCK" },
          ]}
        />
      </Panel>
    </Slot>
  );
};

const EarnCard: React.FC = () => {
  const frame = useCurrentFrame();

  /**
   * The shift minigame, at its real cadence.
   *
   * SHIFT_SWEEP_SEC 1.6, SHIFT_BAND 0.11, SHIFT_ROUNDS 3 — the sweep here runs
   * at the speed a player actually sees, so anyone who has played recognises it.
   */
  const sweep = ((frame / 30) % 1.6) / 1.6;
  const round = Math.min(3, Math.floor(frame / 48) + 1);

  return (
    <Slot>
      <Panel
        eyebrow="Earn"
        title="Work a shift. No wallet needed."
        body="Three rounds, one moving band, 12 CHARGE. It is the income floor — a player who never spends a cent can still earn."
        accent={theme.colors.up}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
          {/* The sweep, with the target band drawn on it. */}
          <div style={{ position: "relative", width: "100%", height: 26 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: `1px solid ${theme.colors.textFaint}66`,
                background: "rgba(0,0,0,0.4)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "44.5%",
                top: 0,
                bottom: 0,
                width: "11%",
                background: `${theme.colors.up}3a`,
                borderLeft: `1px solid ${theme.colors.up}`,
                borderRight: `1px solid ${theme.colors.up}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${sweep * 100}%`,
                top: -4,
                bottom: -4,
                width: 3,
                background: theme.colors.primary,
                boxShadow: `0 0 14px ${theme.colors.primary}`,
              }}
            />
          </div>
          <StatRow
            delay={10}
            items={[
              { label: "Round", value: `${round} / 3` },
              { label: "Cost", value: "12 CHARGE" },
              { label: "Cooldown", value: "30 min" },
            ]}
          />
        </div>
      </Panel>
    </Slot>
  );
};

const TradeCard: React.FC = () => {
  const listings = [
    { symbol: "MU", price: 142, seller: "vault_rat", delta: -18 },
    { symbol: "AMD", price: 96, seller: "0xhalvi", delta: +7 },
    { symbol: "TSM", price: 210, seller: "candle", delta: -4 },
  ];

  return (
    <Slot>
      <Panel
        eyebrow="Trade"
        title="Players set the price, not a formula"
        body="List a floor at whatever you think it is worth. The tower's own price sits next to yours, so nobody has to guess whether it is a bargain."
        accent={theme.colors.accent}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 4 }}>
          {listings.map((l, i) => (
            <Listing key={l.symbol} {...l} delay={10 + i * 6} />
          ))}
        </div>
      </Panel>
    </Slot>
  );
};

const Listing: React.FC<{
  symbol: string;
  price: number;
  seller: string;
  delta: number;
  delay: number;
}> = ({ symbol, price, seller, delta, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.snappy });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr 130px 150px",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: `1px solid ${theme.colors.textFaint}33`,
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [24, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 26,
          fontWeight: 800,
          color: theme.colors.text,
        }}
      >
        {symbol}
      </span>
      <span
        style={{ fontFamily: fontFamilies.mono, fontSize: 19, color: theme.colors.textFaint }}
      >
        {seller}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 24,
          fontWeight: 700,
          color: theme.colors.text,
          textAlign: "right",
        }}
      >
        {price} $B
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 19,
          fontWeight: 700,
          color: delta <= 0 ? theme.colors.up : theme.colors.textFaint,
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {delta > 0 ? "+" : ""}
        {delta}% vs tower
      </span>
    </div>
  );
};
