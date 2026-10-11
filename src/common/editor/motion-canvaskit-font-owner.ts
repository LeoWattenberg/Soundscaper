/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface MotionFontBytes { readonly id: string; readonly bytes: Uint8Array }
export interface MotionFontProviderLease { readonly provider: TypefaceFontProvider; release(): void }
export interface MotionFontProviderOwner {
	acquire(kit: CanvasKit, fonts: readonly MotionFontBytes[], fallbacks: readonly MotionFontBytes[]): MotionFontProviderLease;
	dispose(): void;
	snapshot(): { readonly providers: number; readonly fontBytes: number; readonly activeLeases: number; readonly disposed: boolean };
}
interface Entry { readonly provider: TypefaceFontProvider; readonly byteLength: number; active: number }
const MAXIMUM_FONT_BYTES = 64 * 1024 * 1024;

/** A project/render lease owns exact font closures. No provider or original font bytes live in a global cache. */
export function createMotionFontProviderOwner(kit: CanvasKit, options: { readonly maximumProviders?: number; readonly maximumFontBytes?: number } = {}): MotionFontProviderOwner {
	const maximumProviders = options.maximumProviders ?? 8, maximumFontBytes = options.maximumFontBytes ?? MAXIMUM_FONT_BYTES;
	if (!Number.isSafeInteger(maximumProviders) || maximumProviders < 1 || maximumProviders > 8
		|| !Number.isSafeInteger(maximumFontBytes) || maximumFontBytes < 1 || maximumFontBytes > MAXIMUM_FONT_BYTES) throw new RangeError('Motion font provider ownership exceeds its eight-provider/64 MiB budget.');
	const entries = new Map<string, Entry>(); let fontBytes = 0, disposed = false;
	function remove(key: string, entry: Entry): void { entry.provider.delete(); entries.delete(key); fontBytes -= entry.byteLength; }
	return {
		acquire(runtime, fonts, fallbacks) {
			if (disposed) throw new Error('Motion font provider owner is disposed.');
			if (runtime !== kit) throw new Error('Motion font providers belong to another CanvasKit runtime.');
			const closure = [...fonts, ...fallbacks]; let byteLength = 0;
			for (const font of closure) {
				if (typeof font.id !== 'string' || font.id.length < 1 || font.id.length > 512 || !(font.bytes instanceof Uint8Array) || !font.bytes.byteLength) throw new TypeError('Motion font closure requires a family ID and nonempty bytes.');
				byteLength += font.bytes.byteLength;
				if (byteLength > maximumFontBytes) throw new RangeError('Motion paragraph exceeds its font byte budget.');
			}
			// Hash actual bytes, including fallbacks: mutable buffers and reused asset IDs cannot substitute a prior typeface.
			const key = JSON.stringify(closure.map(font => [font.id, bytesToHex(sha256(font.bytes))]));
			let entry = entries.get(key);
			if (entry) { entries.delete(key); entries.set(key, entry); }
			else {
				while (entries.size >= maximumProviders || fontBytes + byteLength > maximumFontBytes) {
					const oldest = [...entries].find(([, value]) => value.active === 0);
					if (!oldest) throw new RangeError('Motion font provider budget is occupied by active paragraphs.');
					remove(...oldest);
				}
				const provider = kit.TypefaceFontProvider.Make();
				try { for (const font of closure) registerFont(kit, provider, font); }
				catch (error) { provider.delete(); throw error; }
				entry = { provider, byteLength, active: 0 }; entries.set(key, entry); fontBytes += byteLength;
			}
			const retained = entry; retained.active++; let released = false;
			return { provider: retained.provider, release() {
				if (released) return;
				released = true; retained.active--;
				if (disposed && retained.active === 0) remove(key, retained);
			} };
		},
		dispose() { disposed = true; for (const [key, entry] of entries) if (entry.active === 0) remove(key, entry); },
		snapshot: () => ({ providers: entries.size, fontBytes, activeLeases: [...entries.values()].reduce((sum, entry) => sum + entry.active, 0), disposed }),
	};
}

function registerFont(kit: CanvasKit, provider: TypefaceFontProvider, font: MotionFontBytes): void {
	const face = kit.Typeface.MakeFreeTypeFaceFromData(new Uint8Array(font.bytes).buffer);
	if (!face) throw new Error(`Motion font ${font.id} is not a supported font file.`);
	face.delete(); provider.registerFont(font.bytes, font.id);
}
