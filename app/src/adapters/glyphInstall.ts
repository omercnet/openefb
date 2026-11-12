// Installs the bundled glyph ranges (assets/glyphs, Noto Sans Regular, OFL 1.1) into the app's document directory and
// returns the `glyphs` URL template for the map style (domain/map/glyphs.ts). Written once per app version: a marker file
// holds the layout version, so a changed bundle (or a half-written install) is redone.
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { BUNDLED_GLYPH_RANGES, emptyGlyphRangePbf, glyphRangesToGenerate, localGlyphsUrl } from '../domain/map/glyphs';

/** Bump when the bundled ranges or the generated layout change. */
const LAYOUT_VERSION = 'glyphs-1';
const STACK = 'Noto Sans Regular';

/** Metro needs literal requires; keyed by range name. The lint rule is switched off for these lines. */
/* eslint-disable @typescript-eslint/no-require-imports */
const BUNDLED: Record<string, number> = {
  '0-255': require('../../assets/glyphs/Noto Sans Regular/0-255.pbf'),
  '1280-1535': require('../../assets/glyphs/Noto Sans Regular/1280-1535.pbf'),
  '8192-8447': require('../../assets/glyphs/Noto Sans Regular/8192-8447.pbf'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

let installing: Promise<string> | null = null;

/** Resolves to the glyph URL template. Idempotent and shared: concurrent callers wait on one install. */
export function installGlyphs(): Promise<string> {
  installing ??= doInstall().catch((e: unknown) => {
    installing = null; // a failed install may be retried
    throw e;
  });
  return installing;
}

async function doInstall(): Promise<string> {
  const root = new Directory(Paths.document, 'glyphs');
  const stackDir = new Directory(root, STACK);
  const marker = new File(root, '.version');
  const url = localGlyphsUrl(root.uri);
  if (marker.exists && (await marker.text()) === LAYOUT_VERSION) return url;

  stackDir.create({ intermediates: true, idempotent: true });
  for (const range of BUNDLED_GLYPH_RANGES[STACK] ?? []) {
    const module = BUNDLED[range];
    if (module === undefined) throw new Error(`glyph range ${range} is listed but not bundled`);
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();
    if (asset.localUri === null) throw new Error(`glyph range ${range} has no local file`);
    const target = new File(stackDir, `${range}.pbf`);
    if (target.exists) target.delete();
    await new File(asset.localUri).copy(target);
  }
  for (const range of glyphRangesToGenerate(STACK)) {
    const file = new File(stackDir, `${range}.pbf`);
    if (!file.exists) file.create();
    file.write(emptyGlyphRangePbf(STACK, range));
  }
  if (!marker.exists) marker.create();
  marker.write(LAYOUT_VERSION); // last: an interrupted install leaves no marker and is redone
  return url;
}

export type GlyphsState =
  { status: 'loading' } | { status: 'ready'; url: string } | { status: 'failed'; error: string };

/** The glyph URL for the map, once installed. `failed` lets the screen decide (it falls back to the remote endpoint). */
export function useLocalGlyphs(): GlyphsState {
  const [state, setState] = useState<GlyphsState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    installGlyphs().then(
      (url) => alive && setState({ status: 'ready', url }),
      (e: unknown) => alive && setState({ status: 'failed', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
