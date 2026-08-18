/**
 * Uniform spatial hash.
 *
 * Both storm collection and sign traffic previously compared every player
 * against every entity — O(players x entities), on the movement tick in the
 * storm case. Bucketing by cell turns that into a scan of the nine cells around
 * a point, which is effectively constant for any realistic player density.
 *
 * Cell size should be the query radius: then everything within range is
 * guaranteed to be in the 3x3 block of cells around the query point.
 */
export class SpatialGrid<T = string> {
  private cells = new Map<number, T[]>();

  constructor(private cellSize: number) {}

  /** Pack two cell coordinates into one integer key. */
  private key(cx: number, cz: number): number {
    // Offset keeps negatives positive; 4096 is far beyond the world's extent.
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  insert(item: T, x: number, z: number) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const k = this.key(cx, cz);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(item);
    else this.cells.set(k, [item]);
  }

  /**
   * Everything in the nine cells around a point. Returns candidates, not an
   * exact radius query — callers still do a precise distance check.
   */
  near(x: number, z: number): T[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const out: T[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.cells.get(this.key(cx + dx, cz + dz));
        if (bucket) out.push(...bucket);
      }
    }

    return out;
  }

  clear() {
    this.cells.clear();
  }

  get size() {
    return this.cells.size;
  }
}
