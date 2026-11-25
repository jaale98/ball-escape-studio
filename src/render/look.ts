/**
 * Render-only look options: how a run is drawn, never how it plays.
 *
 * `TIKTOK_SAFE` is the "tiktok-safe" style. TikTok re-encodes every upload at a
 * capped bitrate, and the things that suffer most are fine detail (1–2 px
 * lines, tiny balls), lots of small moving detail (dense particles, long
 * fading trails), soft gradients (glows, bloom, vignettes and gradient
 * backdrops band into steps) and film grain (pure noise, which eats the whole
 * bitrate). The style thickens and enlarges the first, thins the second,
 * replaces the third with crisp shapes and drops the last.
 *
 * Nothing here touches the World: the physics, the events and the state hash
 * are identical with the style on or off.
 */
import { HEIGHT, WIDTH } from '../engine/scene';

export interface SafeLook {
  /** Thinnest stroke drawn, in px on the 1080 px wide canvas (lines thinner than this are widened). */
  minStroke: number;
  /** Extra factor on decorative stroke widths (ball outlines, trails, grid, string art). */
  strokeScale: number;
  /** Smallest ball radius drawn, px. Only the drawing grows; collisions use the real radius. */
  minBallRadius: number;
  /** Longest trail, in seconds of video. */
  maxTrailSeconds: number;
  /** Trails at one flat opacity (crisp) instead of fading out (many alpha steps). */
  solidTrails: boolean;
  /** Most particles alive at once. */
  maxParticles: number;
  /** Keep 1 of every N particles a burst would make (and draw them bigger). */
  particleEvery: number;
  particleScale: number;
  /** Largest glow (shadowBlur) in px; 0 = no glow at all. Bloom is always off. */
  maxGlow: number;
  /** 'solid': gradient backdrops and vignettes become flat colors. 'dither': keep them, plus faint static noise to hide banding. */
  gradients: 'solid' | 'dither';
  /** Drop film grain, scanlines and chromatic fringing (high-frequency detail the encoder can't keep). */
  dropNoise: boolean;
  /** Move the counter and banners up out of TikTok's caption area, and narrow wrapped text away from the button column. */
  safeText: boolean;
  /** Shrink and shift the playfield (drawing only) so it sits inside the safe area. */
  fitSafeZone: boolean;
}

export const TIKTOK_SAFE: SafeLook = {
  minStroke: 4,
  strokeScale: 1.5,
  minBallRadius: 9,
  maxTrailSeconds: 0.2,
  solidTrails: true,
  maxParticles: 90,
  particleEvery: 2,
  particleScale: 1.8,
  maxGlow: 0,
  gradients: 'solid',
  dropNoise: true,
  safeText: true,
  fitSafeZone: true,
};

/**
 * Where TikTok draws its own UI on a 1080x1920 video: the top bar (Following /
 * For You), the caption, sound and nav bar at the bottom, and the like /
 * comment / share column on the right. Keep the action outside these.
 */
export const TIKTOK_ZONES = { top: 150, bottom: 350, right: 120 };

/** The area left for the action, in canvas px. */
export const SAFE_RECT = {
  x0: 0,
  y0: TIKTOK_ZONES.top,
  x1: WIDTH - TIKTOK_ZONES.right,
  y1: HEIGHT - TIKTOK_ZONES.bottom,
};

export interface RenderOptions {
  /** Draw at this fraction of 1080x1920 (mini previews use ~0.25). */
  scale?: number;
  /** Allow glow effects (off for mini previews: they're costly). */
  glow?: boolean;
  /** Video frame rate the frames are for (60 default). Trail lengths are kept the same in seconds at any rate. */
  fps?: number;
  /** The tiktok-safe style (null/undefined = the scene's normal look). */
  safe?: SafeLook | null;
}
