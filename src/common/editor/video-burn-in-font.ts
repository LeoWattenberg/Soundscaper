/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The font files a burned-in caption is drawn from.
 *
 * Inter is already this product's interface typeface and already a declared
 * dependency under the SIL Open Font License, so burning captions in adds a use
 * rather than a dependency: no new licensing row, and the face on screen in the
 * editor is the face in the delivered picture.
 *
 * The browser bundle retains only WOFF2. The semibold weight is the one that
 * stays legible over arbitrary picture at small sizes.
 *
 * Which subset a cue needs is decided in `video-burn-in-font-subsets.ts`; this
 * module only knows where each one lives, so the modules that reason about
 * coverage never pull a WOFF2 into their graph.
 */

import cyrillicExtUrl from '@fontsource/inter/files/inter-cyrillic-ext-600-normal.woff2';
import cyrillicUrl from '@fontsource/inter/files/inter-cyrillic-600-normal.woff2';
import latinExtUrl from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2';
import latinUrl from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import {
	VIDEO_BURN_IN_DEFAULT_FONT_SUBSET,
	videoBurnInFontSubset,
} from './video-burn-in-font-subsets.ts';

/** Where each retained subset's WOFF2 lives, by the id the plan states. */
export const VIDEO_BURN_IN_FONT_URLS: Readonly<Record<string, string>> = Object.freeze({
	'latin': latinUrl,
	'latin-ext': latinExtUrl,
	'cyrillic': cyrillicUrl,
	'cyrillic-ext': cyrillicExtUrl,
});

type FetchLike = (input: string) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>;

/**
 * Fetch the font bytes for the subsets one burned-in delivery draws with.
 *
 * The bundler resolves each URL, so this asks the app's own origin for files it
 * already ships; there is no new runtime asset to publish and nothing to fetch
 * across origins.
 */
export async function loadVideoBurnInFonts(
	subsetIds: Iterable<unknown>,
	fetchImpl: FetchLike | undefined = globalThis.fetch as FetchLike | undefined,
): Promise<ReadonlyMap<string, Blob>> {
	if (typeof fetchImpl !== 'function') throw new Error('Loading the caption font needs fetch.');
	const wanted = new Set<string>();
	for (const id of subsetIds) {
		const subset = videoBurnInFontSubset(id);
		if (!subset) throw new RangeError(`No caption font subset named ${String(id)}.`);
		wanted.add(subset.id);
	}
	if (wanted.size === 0) wanted.add(VIDEO_BURN_IN_DEFAULT_FONT_SUBSET);
	const loaded = new Map<string, Blob>();
	for (const id of wanted) {
		// The bundler resolves each URL at build time, so a missing file is a build
		// failure rather than something to guard for here; what this does have to
		// say is which subset failed, since a delivery may need several.
		const response = await fetchImpl(VIDEO_BURN_IN_FONT_URLS[id]!);
		if (!response.ok) {
			throw new Error(`The ${id} caption font could not be loaded (${response.status}).`);
		}
		loaded.set(id, await response.blob());
	}
	return loaded;
}
