/**
 * Pictures in images/ (png, jpg, webp, gif, svg), with hot updates: dropping
 * a photo onto the studio adds it without a page reload ("images-updated").
 *
 * Scenes refer to pictures by file name ("cat.png"). Before drawing a scene,
 * call ensureImages(scene); the renderer then reads them with getImage().
 */
import type { Scene } from './engine/scene';

export const imageFiles = import.meta.glob('../images/*.{png,jpg,jpeg,webp,gif,svg,PNG,JPG,JPEG,WEBP}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

let urls = toUrls(imageFiles);
const cache = new Map<string, HTMLImageElement>();

function toUrls(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([p, url]) => [p.split('/').pop()!, url]));
}

/** File names of every picture in images/. */
export function imageNames(): string[] {
  return Object.keys(urls).sort();
}

export function imageUrl(name: string): string | undefined {
  return urls[name];
}

/** A loaded picture, or undefined if it isn't (yet) available. */
export function getImage(name: string | undefined): HTMLImageElement | undefined {
  if (!name) return undefined;
  const img = cache.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : undefined;
}

/** Every picture a scene uses. */
export function sceneImages(scene: Scene): string[] {
  const out = new Set<string>();
  if (scene.style.backgroundImage) out.add(scene.style.backgroundImage);
  for (const e of scene.entities) {
    if (e.type !== 'ball') continue;
    if (e.image) out.add(e.image);
    for (const i of e.images ?? []) out.add(i);
  }
  return [...out];
}

/** Load every picture the scene uses. Resolves with the names that couldn't be found. */
export async function ensureImages(scene: Scene): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    sceneImages(scene).map(async (name) => {
      if (getImage(name)) return;
      const url = urls[name];
      if (!url) {
        missing.push(name);
        return;
      }
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      cache.set(name, img);
      try {
        await img.decode();
      } catch {
        missing.push(name);
      }
    }),
  );
  return missing;
}

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (!mod) return;
    urls = toUrls(mod.imageFiles as Record<string, string>);
    window.dispatchEvent(new CustomEvent('images-updated'));
  });
}
