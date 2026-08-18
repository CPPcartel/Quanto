import { Container, Sprite, Texture } from "pixi.js";
import { world } from "../net/world";
import { worldToScreen, depthOf } from "./iso";
import { hashString } from "./art";
import { worldTint } from "./daylight";
import { makeDog, makeCat, makeBird } from "./parkArt";

/**
 * Dogs, cats and birds.
 *
 * Client-side and deterministic, for the same reason the sky is: this pays
 * nothing, gates nothing, and spawns nothing, so there is no reason to spend
 * server bandwidth on it at 150 players. Seeded from park ids means every
 * player sees the same dog in the same park, which turns them into landmarks
 * rather than noise.
 *
 * They are also the cheapest thing in the game that makes it feel inhabited.
 */

/** Below this zoom an animal is a couple of pixels; skip the work entirely. */
const CRITTER_LOD = 0.5;

const DOG_FPS = 6;
const DOG_FRAMES = 4;

/** How close a player must come before the birds go up. */
const SCATTER_RANGE = 22;
const SCATTER_MS = 2600;

interface Dog {
  sprite: Sprite;
  seed: number;
  /** Home park, which it never leaves. */
  homeX: number;
  homeZ: number;
  roam: number;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  /** Seconds left standing still before picking a new target. */
  pause: number;
  facing: number;
  frame: number;
  frameTime: number;
}

interface Bird {
  sprite: Sprite;
  baseX: number;
  baseZ: number;
  x: number;
  z: number;
  phase: number;
  /** 0 = on the ground, 1 = fully airborne. */
  lift: number;
}

interface Flock {
  birds: Bird[];
  cx: number;
  cz: number;
  /** ms remaining of the current scatter. */
  scatter: number;
}

export class CritterLayer {
  readonly root = new Container();

  private built = false;
  private dogs: Dog[] = [];
  private cats: Sprite[] = [];
  private flocks: Flock[] = [];
  private lastDayTint = -1;
  private texCache = new Map<string, Texture>();

  constructor() {
    this.root.sortableChildren = true;
    this.root.eventMode = "none";
  }

  private tex(key: string, make: () => Texture): Texture {
    let t = this.texCache.get(key);
    if (!t) {
      t = make();
      this.texCache.set(key, t);
    }
    return t;
  }

  build() {
    if (this.built || world.parks.length === 0) return;
    this.built = true;

    for (const park of world.parks) {
      const rand = seededFrom(`${park.id}:critters`);

      // Not every park has a dog — one in every park reads as a spawner.
      if (park.kind !== "plaza" && rand() < 0.55) {
        this.addDog(park.x, park.z, park.half - 2, rand());
      }
      if (park.kind === "plaza") {
        this.addDog(park.x + 8, park.z - 6, park.half * 0.5, rand());
        this.addDog(park.x - 10, park.z + 4, park.half * 0.5, rand());
      }

      // Birds gather where there is water to drink.
      if (park.kind === "water" || park.kind === "plaza") {
        this.addFlock(park.x, park.z, park.kind === "plaza" ? 9 : 5, rand);
      }

      if (rand() < 0.4) {
        const cx = park.x + (rand() - 0.5) * park.half;
        const cz = park.z + (rand() - 0.5) * park.half;
        const cat = new Sprite(this.tex(`cat${Math.floor(rand() * 5)}`, () => makeCat(rand())));
        cat.anchor.set(0.5, 1);
        const { sx, sy } = worldToScreen(cx, cz);
        cat.position.set(sx, sy);
        cat.zIndex = depthOf(cx, cz);
        this.root.addChild(cat);
        this.cats.push(cat);
      }
    }
  }

  private addDog(x: number, z: number, roam: number, seed: number) {
    const sprite = new Sprite(this.tex(`dog${seed.toFixed(3)}0`, () => makeDog(seed, 0)));
    sprite.anchor.set(0.5, 1);
    this.root.addChild(sprite);
    this.dogs.push({
      sprite,
      seed,
      homeX: x,
      homeZ: z,
      roam: Math.max(3, roam),
      x,
      z,
      targetX: x,
      targetZ: z,
      pause: seed * 2,
      facing: 1,
      frame: 0,
      frameTime: 0,
    });
  }

  private addFlock(cx: number, cz: number, count: number, rand: () => number) {
    const birds: Bird[] = [];
    for (let i = 0; i < count; i++) {
      const bx = cx + (rand() - 0.5) * 12;
      const bz = cz + (rand() - 0.5) * 12;
      const sprite = new Sprite(this.tex("bird0", () => makeBird(0)));
      sprite.anchor.set(0.5, 1);
      this.root.addChild(sprite);
      birds.push({ sprite, baseX: bx, baseZ: bz, x: bx, z: bz, phase: rand() * Math.PI * 2, lift: 0 });
    }
    this.flocks.push({ birds, cx, cz, scatter: 0 });
  }

  // -------------------------------------------------------------------------

  update(dt: number, zoom: number) {
    if (!this.built) return;

    const visible = zoom >= CRITTER_LOD;
    this.root.visible = visible;
    if (!visible) return;

    const day = worldTint(world.daylight?.sun ?? 1);
    if (day !== this.lastDayTint) {
      this.lastDayTint = day;
      for (const d of this.dogs) d.sprite.tint = day;
      for (const c of this.cats) c.tint = day;
      for (const f of this.flocks) for (const b of f.birds) b.sprite.tint = day;
    }

    this.updateDogs(dt);
    this.updateFlocks(dt);
  }

  private updateDogs(dt: number) {
    for (const dog of this.dogs) {
      if (dog.pause > 0) {
        dog.pause -= dt;
        dog.frame = 0;
      } else {
        const dx = dog.targetX - dog.x;
        const dz = dog.targetZ - dog.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.6) {
          // Arrived. Sniff about, then pick somewhere else inside the park.
          const rand = seededFrom(`${dog.seed}:${Math.floor(dog.x * 7 + dog.z * 13)}`);
          dog.pause = 0.8 + rand() * 3;
          const angle = rand() * Math.PI * 2;
          const radius = rand() * dog.roam;
          dog.targetX = dog.homeX + Math.cos(angle) * radius;
          dog.targetZ = dog.homeZ + Math.sin(angle) * radius;
        } else {
          const speed = 2.6;
          dog.x += (dx / dist) * speed * dt;
          dog.z += (dz / dist) * speed * dt;
          // Screen-space facing: moving right on screen means x rising, z falling.
          dog.facing = dx - dz >= 0 ? 1 : -1;

          dog.frameTime += dt;
          if (dog.frameTime > 1 / DOG_FPS) {
            dog.frameTime = 0;
            dog.frame = (dog.frame + 1) % DOG_FRAMES;
          }
        }
      }

      dog.sprite.texture = this.tex(`dog${dog.seed.toFixed(3)}${dog.frame}`, () =>
        makeDog(dog.seed, dog.frame)
      );
      dog.sprite.scale.x = dog.facing;
      const { sx, sy } = worldToScreen(dog.x, dog.z);
      dog.sprite.position.set(sx, sy);
      dog.sprite.zIndex = depthOf(dog.x, dog.z);
    }
  }

  private updateFlocks(dt: number) {
    // The player's predicted position is what they see themselves at, so
    // reacting to it is what makes the scatter feel caused by them.
    const px = world.local.x;
    const pz = world.local.z;

    for (const flock of this.flocks) {
      const near = Math.hypot(px - flock.cx, pz - flock.cz) < SCATTER_RANGE;
      if (near && flock.scatter <= 0) flock.scatter = SCATTER_MS;
      if (flock.scatter > 0) flock.scatter -= dt * 1000;

      const target = flock.scatter > 0 ? 1 : 0;

      for (const bird of flock.birds) {
        bird.lift += (target - bird.lift) * Math.min(1, dt * 3);
        bird.phase += dt * (2 + bird.lift * 6);

        if (bird.lift > 0.02) {
          // Spiral outward and upward while startled, then settle back.
          const spread = bird.lift * 14;
          bird.x = bird.baseX + Math.cos(bird.phase) * spread;
          bird.z = bird.baseZ + Math.sin(bird.phase) * spread;
        } else {
          // Hopping about on the ground.
          bird.x = bird.baseX + Math.sin(bird.phase * 0.7) * 0.8;
          bird.z = bird.baseZ + Math.cos(bird.phase * 0.5) * 0.8;
        }

        const { sx, sy } = worldToScreen(bird.x, bird.z);
        bird.sprite.position.set(sx, sy - bird.lift * 34);
        bird.sprite.zIndex = depthOf(bird.x, bird.z) + (bird.lift > 0.02 ? 900 : 0);
        // One variable for both the cache key and the maker: deriving them
        // separately let the key and the frame drift apart.
        const wing = bird.lift > 0.02 ? Math.floor(bird.phase * 4) % 2 : 0;
        bird.sprite.texture = this.tex(`bird${wing}`, () => makeBird(wing));
      }
    }
  }
}

/** Deterministic randomness from a string key. */
function seededFrom(key: string) {
  let s = Math.floor(hashString(key) * 2147483647) || 12345;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
