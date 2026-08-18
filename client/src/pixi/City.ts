import { Container, Sprite, TilingSprite, Text, TextStyle, Texture, Graphics } from "pixi.js";
import {
  roadLines,
  intersections,
  isBuildable,
  ROAD_HALF,
  ROAD_SPACING,
  KERB,
  CITY_HALF,
} from "./plan";
import { world, type TickerView } from "../net/world";
import { worldToScreen, depthOf, TILE_W, TILE_H, PIXELS_PER_HEIGHT_UNIT, lerp } from "./iso";
import { worldTint } from "./daylight";
import {
  art,
  makeWallTile,
  makeRoof,
  makeSkirt,
  windowSlots,
  districtNeon,
  hashString,
  FLOOR_H,
  PALETTE,
  makeRoofUnit,
} from "./art";

/**
 * The skyline.
 *
 * Each ticker is a tower whose height is its live Chainlink price. A tower is
 * three sprites (tiling facade + roof + skirt) plus one small sprite per lit
 * window, so cost scales with the *economy* — how many floors players own —
 * rather than with the size of the city.
 */

/** Hero towers occupy a 2x2 footprint; filler blocks are 1x1. */
const HERO_SPAN = 2;
const FILLER_SPAN = 1;

/** Below this zoom we stop drawing detail and switch to Skyline Mode. */
export const LOD_ZOOM = 0.35;

const MAX_FLOORS = 40;
const MIN_FLOORS = 6;

export function floorsFor(height: number) {
  return Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round(height / 3)));
}

interface Tower {
  symbol: string;
  root: Container;
  facade: TilingSprite;
  roof: Sprite;
  roofUnit: Sprite;
  skirt: Sprite;
  glow: Sprite;
  label: Text;
  price: Text;
  /** Controlling player or crew, shown above the symbol. */
  landlord: Text;
  windows: Container;
  litSprites: Sprite[];
  span: number;
  district: string;
  /** Eased pixel height, so a price tick reads as growth rather than a jump. */
  renderPx: number;
  lastFloorsLit: number;
  /** Eased highlight brightness for hover/selection. */
  tint: number;
}

interface Filler {
  root: Container;
  facade: TilingSprite;
  roof: Sprite;
  skirt: Sprite;
}

export class CityLayer {
  readonly root = new Container();
  private groundLayer = new Container();
  private buildingLayer = new Container();
  private towers = new Map<string, Tower>();
  private fillers: Filler[] = [];
  /** Last daylight tint written, so static geometry is re-tinted only on change. */
  private lastDayTint = -1;
  private wallCache = new Map<string, Texture>();
  private roofCache = new Map<string, Texture>();
  private skirtCache = new Map<number, Texture>();
  private miscCache = new Map<string, Texture>();
  private built = false;
  private lodActive = false;

  constructor() {
    this.root.addChild(this.groundLayer);
    this.root.addChild(this.buildingLayer);
    // Painter's algorithm: things further back must draw first.
    this.buildingLayer.sortableChildren = true;
    this.groundLayer.sortableChildren = false;
  }

  /** True once server state has arrived and the city has been constructed. */
  get isBuilt() {
    return this.built;
  }

  /**
   * Called when build() threw. Marks the layer as done so the caller stops
   * retrying every frame — one clear error beats an endless error loop.
   */
  markFailed() {
    this.built = true;
  }

  private wallTexture(span: number, district: string, seed: number) {
    const key = `${span}:${district}:${Math.floor(seed * 8)}`;
    let tex = this.wallCache.get(key);
    if (!tex) {
      tex = makeWallTile(span, seed, district);
      this.wallCache.set(key, tex);
    }
    return tex;
  }

  private roofTexture(span: number, district: string) {
    const key = `${span}:${district}`;
    let tex = this.roofCache.get(key);
    if (!tex) {
      tex = makeRoof(span, district);
      this.roofCache.set(key, tex);
    }
    return tex;
  }

  /** Generic cached-texture helper for one-off decorative pieces. */
  private tex(key: string, make: () => Texture): Texture {
    let t = this.miscCache.get(key);
    if (!t) {
      t = make();
      this.miscCache.set(key, t);
    }
    return t;
  }

  private skirtTexture(span: number) {
    let tex = this.skirtCache.get(span);
    if (!tex) {
      tex = makeSkirt(span);
      this.skirtCache.set(span, tex);
    }
    return tex;
  }

  /** Build the whole city once the ticker roster has arrived. */
  build() {
    if (this.built || world.tickers.size === 0) return;

    this.buildGround();
    this.buildFiller();
    world.tickers.forEach((t) => this.buildTower(t));

    this.built = true;
  }

  private buildGround() {
    // Base surface: one TilingSprite for the whole playfield, one draw call.
    const corners = [
      worldToScreen(-220, -220),
      worldToScreen(220, -220),
      worldToScreen(220, 220),
      worldToScreen(-220, 220),
    ];
    const minX = Math.min(...corners.map((c) => c.sx));
    const maxX = Math.max(...corners.map((c) => c.sx));
    const minY = Math.min(...corners.map((c) => c.sy));
    const maxY = Math.max(...corners.map((c) => c.sy));

    const ground = new TilingSprite({
      texture: art().ground,
      width: maxX - minX,
      height: maxY - minY,
    });
    ground.position.set(minX, minY);
    this.groundLayer.addChild(ground);

    this.buildRoads();
  }

  /**
   * The road network, drawn as isometric quads from the shared city plan.
   *
   * Roads used to be baked into the ground texture on a texture-space period,
   * which never aligned with the world-space grid the buildings avoid — so
   * painted roads ran under towers while the real gaps between blocks sat
   * blank. Drawing them from `plan.ts` means streets and buildings agree by
   * construction, and it is still only a couple of draw calls because it is
   * all one Graphics object.
   */
  private buildRoads() {
    const surface = new Graphics();
    const markings = new Graphics();

    const quad = (g: Graphics, ax: number, az: number, bx: number, bz: number, half: number, alongX: boolean) => {
      const p = alongX
        ? [
            worldToScreen(ax, az - half),
            worldToScreen(bx, bz - half),
            worldToScreen(bx, bz + half),
            worldToScreen(ax, az + half),
          ]
        : [
            worldToScreen(ax - half, az),
            worldToScreen(bx - half, bz),
            worldToScreen(bx + half, bz),
            worldToScreen(ax + half, az),
          ];
      g.moveTo(p[0].sx, p[0].sy);
      g.lineTo(p[1].sx, p[1].sy);
      g.lineTo(p[2].sx, p[2].sy);
      g.lineTo(p[3].sx, p[3].sy);
      g.closePath();
    };

    const lines = roadLines();

    // Carriageways both ways, then pavements as a lighter border.
    for (const line of lines) {
      quad(surface, -CITY_HALF, line, CITY_HALF, line, ROAD_HALF, true);
      quad(surface, line, -CITY_HALF, line, CITY_HALF, ROAD_HALF, false);
    }
    surface.fill({ color: 0x0e111a });

    for (const line of lines) {
      quad(markings, -CITY_HALF, line, CITY_HALF, line, ROAD_HALF + KERB, true);
      quad(markings, line, -CITY_HALF, line, CITY_HALF, ROAD_HALF + KERB, false);
    }
    markings.fill({ color: 0x191d2a });

    // Pavement goes underneath the carriageway so the kerb reads as an edge.
    this.groundLayer.addChild(markings);
    this.groundLayer.addChild(surface);

    // Centre lines, broken into dashes.
    const dashes = new Graphics();
    for (const line of lines) {
      for (let t = -CITY_HALF; t < CITY_HALF; t += 12) {
        if (Math.abs(((t % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING) < ROAD_HALF + KERB) continue;
        quad(dashes, t, line, t + 6, line, 0.5, true);
        quad(dashes, line, t, line, t + 6, 0.5, false);
      }
    }
    dashes.fill({ color: 0x3a4258, alpha: 0.55 });
    this.groundLayer.addChild(dashes);

    // Zebra crossings on the approach to every junction.
    const crossings = new Graphics();
    for (const { x, z } of intersections()) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const o = -ROAD_HALF + 2 + i * 3.6;
          const at = z + side * (ROAD_HALF + 2.2);
          quad(crossings, x + o, at, x + o + 2, at, 2.4, false);
          const at2 = x + side * (ROAD_HALF + 2.2);
          quad(crossings, at2, z + o, at2, z + o + 2, 2.4, true);
        }
      }
    }
    crossings.fill({ color: 0x9aa6c4, alpha: 0.22 });
    this.groundLayer.addChild(crossings);
  }

  /**
   * Low-rise filler so districts read as a real dense city rather than a few
   * lonely towers. Deterministic layout — same city every session.
   */
  private buildFiller() {
    const spots: Array<{ x: number; z: number; seed: number }> = [];

    for (let x = -190; x <= 190; x += 13) {
      for (let z = -190; z <= 190; z += 13) {
        // Same plan the roads are drawn from, so buildings never sit on tarmac.
        if (!isBuildable(x, z)) continue;
        if (Math.hypot(x, z) < 40) continue;
        /**
         * Never build on a park.
         *
         * Tested against the replicated rectangles rather than by re-deriving
         * the park rule here. Two independent derivations of the same layout is
         * exactly how the roads and buildings drifted apart before; a
         * containment test against what the server actually sent cannot drift.
         */
        if (parkCovers(x, z)) continue;
        // Keep clear of hero tower plots.
        let blocked = false;
        world.tickers.forEach((t) => {
          if (Math.abs(t.x - x) < 24 && Math.abs(t.z - z) < 24) blocked = true;
        });
        if (blocked) continue;
        spots.push({ x, z, seed: hashString(`${x},${z}`) });
      }
    }

    for (const spot of spots) {
      if (spot.seed < 0.32) continue; // leave gaps: courtyards and lots
      const district = nearestDistrictId(spot.x, spot.z);
      const floors = 2 + Math.floor(spot.seed * 6);
      const px = floors * FLOOR_H;

      const root = new Container();
      const { sx, sy } = worldToScreen(spot.x, spot.z);
      root.position.set(sx, sy);
      root.zIndex = depthOf(spot.x, spot.z);

      const skirt = new Sprite(this.skirtTexture(FILLER_SPAN));
      skirt.anchor.set(0.5, 0);
      skirt.position.set(0, 0);

      const facade = new TilingSprite({
        texture: this.wallTexture(FILLER_SPAN, district, spot.seed),
        width: TILE_W * FILLER_SPAN,
        height: px,
      });
      facade.anchor.set(0.5, 1);
      facade.position.set(0, 0);

      const roof = new Sprite(this.roofTexture(FILLER_SPAN, district));
      roof.anchor.set(0.5, 1);
      roof.position.set(0, -px + 4);

      root.addChild(skirt, facade, roof);
      this.buildingLayer.addChild(root);
      this.fillers.push({ root, facade, roof, skirt });
    }
  }

  private buildTower(t: TickerView) {
    const seed = hashString(t.symbol);
    const span = HERO_SPAN;
    const root = new Container();
    const { sx, sy } = worldToScreen(t.x, t.z);
    root.position.set(sx, sy);
    root.zIndex = depthOf(t.x, t.z);

    // Ground glow pooling under the tower — cheap, and sells the wet street.
    const glow = new Sprite(art().glow[glowKeyFor(t.district)]);
    glow.anchor.set(0.5, 0.5);
    glow.width = TILE_W * span * 2.2;
    glow.height = TILE_H * span * 2.4;
    glow.blendMode = "add";
    glow.alpha = 0.32;

    const skirt = new Sprite(this.skirtTexture(span));
    skirt.anchor.set(0.5, 0);

    const facade = new TilingSprite({
      texture: this.wallTexture(span, t.district, seed),
      width: TILE_W * span,
      height: 40,
    });
    facade.anchor.set(0.5, 1);

    const roof = new Sprite(this.roofTexture(span, t.district));
    roof.anchor.set(0.5, 1);

    // Rooftop clutter — an AC block, water tank or antenna — so towers don't
    // terminate in a bare slab against the sky.
    const roofUnit = new Sprite(this.tex(`roofunit${Math.floor(seed * 5)}`, () => makeRoofUnit(seed)));
    roofUnit.anchor.set(0.5, 1);
    roofUnit.position.x = (seed - 0.5) * 26;

    const windows = new Container();

    const label = new Text({
      text: t.symbol,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 13,
        fontWeight: "700",
        fill: "#ECEDF3",
        stroke: { color: "#05060C", width: 4 },
      }),
    });
    label.anchor.set(0.5, 1);
    label.resolution = 2;

    const price = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 11,
        fill: districtNeon(t.district),
        stroke: { color: "#05060C", width: 4 },
      }),
    });
    price.anchor.set(0.5, 1);
    price.resolution = 2;

    /**
     * Who controls this tower. Empty for most buildings most of the time, so it
     * is created once and left blank rather than allocated per frame — and the
     * blank string is what hides it, since an invisible Text still costs a
     * texture upload each time its content changes.
     */
    const landlord = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 10,
        fontWeight: "700",
        fill: "#ECEDF3",
        stroke: { color: "#05060C", width: 4 },
      }),
    });
    landlord.anchor.set(0.5, 1);
    landlord.resolution = 2;

    root.addChild(glow, skirt, facade, windows, roof, roofUnit, label, price, landlord);
    this.buildingLayer.addChild(root);

    this.towers.set(t.symbol, {
      symbol: t.symbol,
      root,
      facade,
      roof,
      roofUnit,
      skirt,
      glow,
      label,
      price,
      landlord,
      windows,
      litSprites: [],
      span,
      district: t.district,
      renderPx: 40,
      lastFloorsLit: -1,
      tint: 1,
    });
  }

  /**
   * Nearest tower to a world position, within a generous radius. Used for
   * pointer picking — hit-testing the isometric prisms exactly would be far
   * more code for no perceptible gain at this footprint size.
   */
  pickAt(x: number, z: number): string {
    let best = "";
    let bestDist = 20;
    world.tickers.forEach((t) => {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = t.symbol;
      }
    });
    return best;
  }

  /**
   * Per-frame update. Heights ease toward the live price; lit windows are
   * rebuilt only when the owned-floor count actually changes.
   */
  update(zoom: number, dt: number) {
    if (!this.built) return;

    const lod = zoom < LOD_ZOOM;
    if (lod !== this.lodActive) {
      this.lodActive = lod;
      this.applyLod(lod);
    }

    /**
     * Time of day, applied to solid surfaces only. Lit windows, neon and glow
     * are deliberately left at full brightness — the contrast between a dark
     * street and bright windows is the whole night look.
     */
    const day = worldTint(world.daylight?.sun ?? 1);

    /**
     * The ground and the low-rise filler blocks are static, so they are only
     * re-tinted when the light has actually moved. Without this guard the
     * filler loop would reassign hundreds of tints every frame to write the
     * identical value.
     */
    if (day !== this.lastDayTint) {
      this.lastDayTint = day;
      this.groundLayer.tint = day;
      for (const f of this.fillers) {
        f.facade.tint = day;
        f.roof.tint = day;
        f.skirt.tint = day;
      }
    }

    this.towers.forEach((tower) => {
      const t = world.tickers.get(tower.symbol);
      if (!t) return;

      const targetPx = Math.max(FLOOR_H * MIN_FLOORS, t.height * PIXELS_PER_HEIGHT_UNIT);
      tower.renderPx = lerp(tower.renderPx, targetPx, Math.min(1, dt * 2.2));
      const px = tower.renderPx;

      tower.facade.height = px;
      tower.roof.position.y = -px + 4;
      tower.roofUnit.position.y = -px + 4;
      tower.glow.position.set(0, 0);

      // Highlight whatever the player is pointing at or has open.
      const isSelected = world.selected === tower.symbol;
      const isHovered = world.hovered === tower.symbol;
      const targetTint = isSelected ? 1.35 : isHovered ? 1.18 : 1;
      tower.tint = lerp(tower.tint, targetTint, Math.min(1, dt * 10));
      // The hover/select highlight multiplies the daylight tint rather than
      // replacing it, so pointing at a tower at night brightens it without
      // teleporting that one building back to noon.
      const tintValue = scaleColor(day, Math.min(1, tower.tint));
      tower.facade.tint = tintValue;
      tower.roof.tint = tintValue;
      tower.skirt.tint = tintValue;

      // Frozen feeds drain of colour; live ones keep their district neon.
      tower.glow.alpha = lerp(tower.glow.alpha, t.frozen ? 0.1 : 0.3 + Math.min(0.35, t.volatility * 60), 0.05);

      if (!lod) {
        tower.label.position.y = -px - 26;
        tower.price.position.y = -px - 12;
        tower.landlord.position.y = -px - 40;

        // Landlord identity is deliberately part of the skyline, not a panel:
        // you should be able to see who runs a block by walking down it.
        const owner = t.landlordName
          ? `${t.landlordIsCrew ? `[${t.landlordName}]` : t.landlordName} ◆`
          : "";
        if (tower.landlord.text !== owner) tower.landlord.text = owner;
        if (owner) tower.landlord.style.fill = t.landlordColor || "#ECEDF3";
        const priceText = t.price > 0 ? `$${fmt(t.price)}` : "—";
        const changeText = t.frozen
          ? "◆ frozen"
          : `${t.changePct >= 0 ? "▲" : "▼"} ${Math.abs(t.changePct).toFixed(2)}%`;
        const next = `${priceText}  ${changeText}`;
        if (tower.price.text !== next) tower.price.text = next;
        tower.price.style.fill = t.frozen
          ? PALETTE.windowFrame
          : t.changePct >= 0
            ? PALETTE.neonLime
            : PALETTE.neonRed;

        this.syncWindows(tower, t);
      }
    });
  }

  /**
   * Lit windows are owned floors. This is the core visual: the city's glow is
   * literally the player economy. Sprites are only created for owned floors.
   */
  private syncWindows(tower: Tower, t: TickerView) {
    const totalFloors = floorsFor(t.height);
    const owned = Math.min(t.ownedFloors ?? 0, totalFloors);
    if (owned === tower.lastFloorsLit) return;
    tower.lastFloorsLit = owned;

    tower.windows.removeChildren();
    tower.litSprites.length = 0;
    if (owned <= 0) return;

    const slots = windowSlots(tower.span);
    const tex = art().litWindow[litKeyFor(tower.district)];
    const halfW = (TILE_W * tower.span) / 2;

    for (let floor = 0; floor < owned; floor++) {
      const yTop = -(floor + 1) * FLOOR_H;
      for (const slot of slots) {
        const s = new Sprite(tex);
        s.position.set(slot.x - halfW, yTop + slot.y);
        s.blendMode = "add";
        s.alpha = 0.9;
        tower.windows.addChild(s);
        tower.litSprites.push(s);
      }
    }
  }

  /** Skyline Mode: drop detail so the full-map pull-out stays cheap. */
  /**
   * Skyline Mode — drop *detail*, never structure.
   *
   * An earlier version hid the ground and the filler blocks too, which left 38
   * towers floating in black. That read as a broken view rather than a
   * deliberate one, and it threw away the thing the pull-out exists to show:
   * the shape of the whole city at once.
   *
   * What actually costs anything at distance is per-floor window sprites and
   * text, so those are what goes. The ground is a single TilingSprite plus one
   * Graphics for the roads, and the filler blocks are three sprites each —
   * cheap, and they *are* the city's mass when seen from above.
   */
  private applyLod(lod: boolean) {
    this.towers.forEach((tower) => {
      // Text is the expensive one — every label is its own texture.
      tower.label.visible = !lod;
      tower.price.visible = !lod;
      tower.landlord.visible = !lod && tower.landlord.text !== "";
      // Lit windows are one sprite per owned floor across the whole city.
      tower.windows.visible = !lod;
      // Glow carries the read at distance, so push it up as detail drops out.
      tower.glow.alpha = lod ? 0.55 : 0.3;
    });
  }
}

function glowKeyFor(district: string) {
  return district === "tech"
    ? "cyan"
    : district === "moonshot"
      ? "magenta"
      : district === "crypto"
        ? "amber"
        : "lime";
}

function litKeyFor(district: string) {
  return district === "tech"
    ? "cyan"
    : district === "moonshot"
      ? "magenta"
      : district === "crypto"
        ? "amber"
        : "lime";
}

function nearestDistrictId(x: number, z: number): string {
  let best = "tech";
  let bestDist = Infinity;
  for (const d of world.districts) {
    const dist = Math.hypot(d.cx - x, d.cz - z);
    if (dist < bestDist) {
      bestDist = dist;
      best = d.id;
    }
  }
  return best;
}

function fmt(price: number) {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toPrecision(3);
}

/** Multiply a packed colour by a scalar, clamped per channel. */
function scaleColor(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((color & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

/** True if any replicated park covers this point. */
function parkCovers(x: number, z: number): boolean {
  for (const park of world.parks) {
    if (park.kind === "plaza") {
      if (Math.hypot(x - park.x, z - park.z) <= park.half) return true;
      continue;
    }
    // A little slack so a building never crowds a park's hedge line.
    const pad = park.half + 4;
    if (Math.abs(x - park.x) <= pad && Math.abs(z - park.z) <= pad) return true;
  }
  return false;
}
