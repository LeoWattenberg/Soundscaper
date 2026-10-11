/* SPDX-License-Identifier: AGPL-3.0-only */

// Import this module dynamically: the loader, WASM and fallback fonts never enter editor startup.
import CanvasKitInit from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import latinUrl from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import latinExtUrl from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2?url';
import greekUrl from '@fontsource/inter/files/inter-greek-400-normal.woff2?url';
import greekExtUrl from '@fontsource/inter/files/inter-greek-ext-400-normal.woff2?url';
import cyrillicUrl from '@fontsource/inter/files/inter-cyrillic-400-normal.woff2?url';
import cyrillicExtUrl from '@fontsource/inter/files/inter-cyrillic-ext-400-normal.woff2?url';
import vietnameseUrl from '@fontsource/inter/files/inter-vietnamese-400-normal.woff2?url';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import manifest from '../../../config/motionscaper-raster-runtime.json';
import type { CanvasKit } from 'canvaskit-wasm';
import type { MotionFontBytes } from './motion-canvaskit-text.ts';
import type { MotionAsset } from './motion-asset.ts';

export interface MotionRasterRuntime { readonly kit: CanvasKit; readonly fallbackFonts: readonly MotionFontBytes[] }
const fontUrls = { 'inter-latin': latinUrl, 'inter-latin-ext': latinExtUrl, 'inter-greek': greekUrl, 'inter-greek-ext': greekExtUrl,
	'inter-cyrillic': cyrillicUrl, 'inter-cyrillic-ext': cyrillicExtUrl, 'inter-vietnamese': vietnameseUrl };

export async function initializeMotionRasterRuntime(): Promise<MotionRasterRuntime> {
	const [wasmBinary, fallbackFonts] = await Promise.all([loadPinned('wasm', wasmUrl), Promise.all(Object.entries(fontUrls).map(async ([id, url]) => ({ id, bytes: await loadPinned(id, url) })))]);
	// Emscripten accepts verified bytes; CanvasKit's declaration omits this standard option.
	const options = { wasmBinary, locateFile: () => wasmUrl };
	const kit = await CanvasKitInit(options);
	return Object.freeze({ kit, fallbackFonts: Object.freeze(fallbackFonts.map((font) => Object.freeze(font))) });
}

/** New text layers retain their chosen bundled font as an ordinary digest-bound project asset. */
export function motionDefaultFontAsset(runtime: MotionRasterRuntime): Readonly<{ asset: MotionAsset; bytes: Uint8Array }> {
	const font = runtime.fallbackFonts.find((candidate) => candidate.id === 'inter-latin');
	const pin = manifest.assets.find((asset) => asset.id === 'inter-latin');
	if (!font || !pin) throw new Error('The bundled motion font is unavailable.');
	return Object.freeze({ asset: Object.freeze({ kind: 'font', id: 'bundled-inter-regular', name: 'Inter Regular', family: 'Inter', style: 'Regular',
		sha256: pin.sha256, byteLength: pin.byteLength, storageKey: `motion-sha256:${pin.sha256}`, mimeType: 'font/woff2' }), bytes: new Uint8Array(font.bytes) });
}

async function loadPinned(id: string, url: string): Promise<Uint8Array<ArrayBuffer>> {
	const pin = manifest.assets.find((asset) => asset.id === id);
	if (!pin) throw new Error(`Motion runtime asset ${id} has no retained digest.`);
	const response = await fetch(url, { credentials: 'same-origin' });
	if (!response.ok) throw new Error(`Motion runtime asset ${id} could not load (${response.status}); install/cache the motion workspace before working offline.`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength !== pin.byteLength || bytesToHex(sha256(bytes)) !== pin.sha256) throw new Error(`Motion runtime asset ${id} failed its retained digest check.`);
	return bytes;
}
