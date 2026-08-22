import { Container, Sprite, Text, TextStyle } from "pixi.js";
import { world } from "../net/world";
import { worldToScreen, depthOf, facingFromYaw, lerp } from "./iso";
import { art, characterSet, CHAR_FRAMES } from "./art";
import { sampleBuffer, shortestAngle, INTERP_DELAY_MS } from "../net/prediction";
import { LOD_ZOOM } from "./City";

/**
 * Every character in the city.
 *
 * The local player is drawn from the predicted position (instant response);
 * everyone else is drawn ~100ms in the past and interpolated between server
 * snapshots. Both rules are unchanged from the 3D build — only the drawing is
 * different.
 */

const WALK_FPS = 8;

interface Actor {
  root: Container;
  sprite: Sprite;
  shadow: Sprite;
  nameplate: Text;
  /** Speech bubble, created lazily — most actors never say anything. */
  bubble?: Text;
  emote?: Text;
  /** Crew tag, also lazy — unaffiliated players never allocate one. */
  tagplate?: Text;
  lastTag: string;
  /** Trait code or hex colour currently being rendered. */
  color: string;
  /** Tier badge, lazy — most players hold nothing. */
  tierplate?: Text;
  lastTier: string;
  frameTime: number;
  frame: number;
  yaw: number;
  isLocal: boolean;
  lastBubble: string;
}

/** How long a line stays above a head before fading out. */
const BUBBLE_MS = 6000;

const EMOTE_GLYPH: Record<string, string> = {
  wave: "👋",
  point: "👉",
  laugh: "😄",
  shrug: "🤷",
  dance: "🕺",
  think: "🤔",
};

export class ActorLayer {
  readonly root = new Container();
  private actors = new Map<string, Actor>();

  constructor() {
    this.root.sortableChildren = true;
  }

  /**
   * `look` is either a six-digit trait code (an NFT holder) or a hex colour
   * (everyone else). `characterSet` accepts both, so guests and holders go down
   * the same path and a holder is not the only kind of player that renders.
   */
  private spawn(id: string, look: string, name: string, isLocal: boolean): Actor {
    const color = look;
    const root = new Container();

    // Contact shadow keeps the figure planted on the ground plane.
    const shadow = new Sprite(art().glow.white);
    shadow.anchor.set(0.5, 0.5);
    shadow.width = 22;
    shadow.height = 11;
    shadow.alpha = 0.22;
    shadow.tint = 0x000000;

    const sprite = new Sprite(characterSet(color)[0][0]);
    // Anchor at the feet so the sprite stands on its tile.
    sprite.anchor.set(0.5, 1);

    const nameplate = new Text({
      text: isLocal ? `${name} (you)` : name,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 10,
        fill: isLocal ? "#FFFFFF" : color,
        stroke: { color: "#05060C", width: 4 },
      }),
    });
    nameplate.anchor.set(0.5, 1);
    nameplate.position.y = -38;
    nameplate.resolution = 2;

    root.addChild(shadow, sprite, nameplate);
    this.root.addChild(root);

    const actor: Actor = {
      root,
      sprite,
      shadow,
      nameplate,
      lastBubble: "",
      lastTag: "",
      lastTier: "",
      color,
      frameTime: 0,
      frame: 0,
      yaw: 0,
      isLocal,
    };
    this.actors.set(id, actor);
    return actor;
  }

  private despawn(id: string) {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.root.destroy({ children: true });
    this.actors.delete(id);
  }

  update(zoom: number, dt: number) {
    const lod = zoom < LOD_ZOOM;
    const renderTime = performance.now() - INTERP_DELAY_MS;

    // ---- local player -----------------------------------------------------
    if (world.conn === "connected") {
      let me = this.actors.get("__local");
      if (!me) me = this.spawn("__local", lookOf(world.localTier, world.localTraits, world.localColor), world.localName, true);
      this.place(me, world.local.x, world.local.z, world.local.yaw, world.local.anim, dt, lod, world.sessionId, world.localEmote);
      if (me.nameplate.text !== `${world.localName} (you)`) {
        me.nameplate.text = `${world.localName} (you)`;
      }
      this.setCrewTag(me, world.crew?.tag ?? "", world.crew?.color ?? "");
      this.setLook(me, lookOf(world.localTier, world.localTraits, world.localColor), world.localTier);
    }

    // ---- remotes ----------------------------------------------------------
    const seen = new Set<string>();
    world.remotes.forEach((remote, id) => {
      seen.add(id);
      let actor = this.actors.get(id);
      if (!actor) actor = this.spawn(id, lookOf(remote.tier, remote.traits, remote.color), remote.name, false);

      const snap = sampleBuffer(remote.buffer, renderTime);
      if (!snap) return;
      this.place(actor, snap.x, snap.z, snap.yaw, remote.anim, dt, lod, id, remote.emote);

      if (actor.nameplate.text !== remote.name) actor.nameplate.text = remote.name;
      this.setCrewTag(actor, remote.crewTag, remote.crewColor);
      // Tier resolves a moment after join, so appearance has to be able to
      // change on a live actor rather than only at spawn.
      this.setLook(actor, lookOf(remote.tier, remote.traits, remote.color), remote.tier);
    });

    // Drop actors whose player left.
    this.actors.forEach((_a, id) => {
      if (id !== "__local" && !seen.has(id)) this.despawn(id);
    });
  }

  /**
   * Show the crew tag above the nameplate, in the crew's colour.
   *
   * Created on first use and hidden rather than destroyed when somebody leaves
   * a crew — most players in view are unaffiliated, and a Text per actor is a
   * texture per actor. The `lastTag` guard keeps this from re-uploading the
   * same glyphs every frame.
   */
  private setCrewTag(actor: Actor, tag: string, color: string) {
    const key = `${tag}|${color}`;
    if (actor.lastTag === key) return;
    actor.lastTag = key;

    if (!tag) {
      // Empty text, not just hidden: `place()` uses the text as the has-a-crew
      // signal when restoring visibility after a zoom-out, and a hidden plate
      // that still reads "[BULL]" would pop back on for an ex-member.
      if (actor.tagplate) actor.tagplate.text = "";
      return;
    }

    if (!actor.tagplate) {
      actor.tagplate = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 9,
          fontWeight: "700",
          fill: 0xffffff,
        }),
      });
      actor.tagplate.anchor.set(0.5, 1);
      actor.tagplate.position.y = -50;
      actor.tagplate.resolution = 2;
      actor.root.addChild(actor.tagplate);
    }

    actor.tagplate.text = `[${tag}]`;
    actor.tagplate.style.fill = color || "#ffffff";
    actor.tagplate.visible = true;
  }

  /**
   * Swap an actor's appearance and tier badge.
   *
   * Guarded on the values actually rendered: without that this would re-resolve
   * a 32-texture walk set every frame for every player on screen.
   */
  private setLook(actor: Actor, look: string, tier: string) {
    if (actor.color !== look) {
      actor.color = look;
      // The texture for the current facing is applied on the next place().
      actor.frame = 0;
    }

    if (actor.lastTier === tier) return;
    actor.lastTier = tier;

    const label = TIER_BADGE[tier];
    if (!label) {
      if (actor.tierplate) actor.tierplate.text = "";
      return;
    }

    if (!actor.tierplate) {
      actor.tierplate = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 9,
          fontWeight: "700",
          fill: 0xffd166,
          stroke: { color: "#05060C", width: 3 },
        }),
      });
      actor.tierplate.anchor.set(0.5, 1);
      actor.tierplate.position.y = -62;
      actor.tierplate.resolution = 2;
      actor.root.addChild(actor.tierplate);
    }

    actor.tierplate.text = label;
    actor.tierplate.style.fill = TIER_COLOR[tier] ?? 0xffd166;
    actor.tierplate.visible = true;
  }

  private place(
    actor: Actor,
    x: number,
    z: number,
    yaw: number,
    anim: string,
    dt: number,
    lod: boolean,
    sessionId: string,
    emote: string
  ) {
    const { sx, sy } = worldToScreen(x, z);
    actor.root.position.set(sx, sy);
    actor.root.zIndex = depthOf(x, z);

    // At far zoom characters become dots, so skip animation work entirely.
    actor.nameplate.visible = !lod;
    if (actor.tagplate) actor.tagplate.visible = !lod && actor.tagplate.text !== "";
    if (actor.tierplate) actor.tierplate.visible = !lod && actor.tierplate.text !== "";
    if (lod) {
      actor.sprite.visible = false;
      actor.shadow.visible = true;
      actor.shadow.tint = 0xffffff;
      actor.shadow.alpha = 0.8;
      actor.shadow.width = 8;
      actor.shadow.height = 8;
      return;
    }

    this.speak(actor, sessionId);
    this.showEmote(actor, emote);

    actor.sprite.visible = true;
    actor.shadow.tint = 0x000000;
    actor.shadow.alpha = 0.22;
    actor.shadow.width = 22;
    actor.shadow.height = 11;

    // Ease facing so a quick direction change doesn't strobe between sprites.
    actor.yaw += shortestAngle(actor.yaw, yaw) * Math.min(1, dt * 12);

    const moving = anim === "walk" || anim === "run";
    if (moving) {
      actor.frameTime += dt * (anim === "run" ? WALK_FPS * 1.6 : WALK_FPS);
      actor.frame = Math.floor(actor.frameTime) % CHAR_FRAMES;
    } else {
      actor.frameTime = 0;
      actor.frame = 0;
    }

    const dir = facingFromYaw(actor.yaw);
    const set = characterSet(actor.color);
    actor.sprite.texture = set[dir][actor.frame];
  }

  /**
   * Show whatever this player last said, fading out after BUBBLE_MS.
   *
   * The Text object is created on first use — most players in view never say
   * anything, and a Text per actor is a texture per actor.
   */
  private speak(actor: Actor, sessionId: string) {
    const line = world.bubbles.get(sessionId);

    if (!line || performance.now() - line.at > BUBBLE_MS) {
      if (actor.bubble) actor.bubble.visible = false;
      return;
    }

    if (!actor.bubble) {
      actor.bubble = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 11,
          fill: "#FFFFFF",
          stroke: { color: "#05060C", width: 4 },
          align: "center",
          wordWrap: true,
          wordWrapWidth: 190,
        }),
      });
      actor.bubble.anchor.set(0.5, 1);
      actor.bubble.resolution = 2;
      actor.root.addChild(actor.bubble);
    }

    // Only rebuild the texture when the words actually change.
    if (actor.lastBubble !== line.text) {
      actor.bubble.text = line.text;
      actor.lastBubble = line.text;
    }

    const age = performance.now() - line.at;
    actor.bubble.visible = true;
    actor.bubble.position.y = -52;
    // Hold, then fade over the last second rather than blinking out.
    actor.bubble.alpha = Math.min(1, (BUBBLE_MS - age) / 1000);
  }

  /** Emote glyph above the head; the server clears it after a few seconds. */
  private showEmote(actor: Actor, emote: string) {
    if (!emote) {
      if (actor.emote) actor.emote.visible = false;
      return;
    }

    if (!actor.emote) {
      actor.emote = new Text({
        text: "",
        style: new TextStyle({ fontFamily: "sans-serif", fontSize: 18 }),
      });
      actor.emote.anchor.set(0.5, 1);
      actor.emote.resolution = 2;
      actor.root.addChild(actor.emote);
    }

    const glyph = EMOTE_GLYPH[emote] ?? "";
    if (actor.emote.text !== glyph) actor.emote.text = glyph;
    actor.emote.visible = Boolean(glyph);
    // Small bob so it reads as an action rather than a sticker.
    actor.emote.position.set(18, -40 + Math.sin(performance.now() / 220) * 3);
  }

  /** World position of the local actor in screen space, for camera follow. */
  localScreenPos() {
    return worldToScreen(world.local.x, world.local.z);
  }
}

export { lerp };

/**
 * What a player is rendered from.
 *
 * Holders wear their token's traits; everyone else keeps the colour the server
 * assigned them. Passing the colour through unchanged is what keeps guests
 * looking exactly as they did before the collection existed — the NFT adds an
 * appearance, it does not take one away.
 */
function lookOf(_tier: string, traits: string, color: string): string {
  /**
   * A chosen look wins; an empty one falls back to colour.
   *
   * This used to require a tier, so traits were ignored for anybody without an
   * NFT and the appearance customiser silently did nothing for exactly the
   * players most likely to open it.
   *
   * Tier is no longer consulted at all. Which options a player is ENTITLED to
   * is decided server-side in sanitiseTraits, and re-deciding it here would
   * mean two places can disagree about what somebody is allowed to wear. The
   * renderer's only job is to draw what it was given.
   */
  return traits ? traits : color;
}

/** Badges are short: they sit above a nameplate that is already busy. */
const TIER_BADGE: Record<string, string> = {
  penthouse: "◆ PENTHOUSE",
  landlord: "◆ LANDLORD",
  resident: "◆ RESIDENT",
};

const TIER_COLOR: Record<string, number> = {
  penthouse: 0xffd166,
  landlord: 0x22e8ff,
  resident: 0x8a92a6,
};
