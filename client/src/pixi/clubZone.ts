/**
 * Shared constants for The Vault's audible and visible reach.
 *
 * In their own module so `audio.ts` does not have to import `Club.ts`, which
 * pulls in Pixi — the audio layer should be able to run without a renderer.
 */

/**
 * How far past the wall the music is still audible, in world units.
 *
 * Roughly a block. Far enough that the sound pulls you toward the venue, near
 * enough that it is not playing across the whole city.
 */
export const CLUB_FALLOFF = 46;
