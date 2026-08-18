/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The font a burned-in caption is drawn with.
 *
 * Inter is already this product's interface typeface and already a declared
 * dependency under the SIL Open Font License, so burning captions in adds a use
 * rather than a dependency: no new licensing row, and the face on screen in the
 * editor is the face in the delivered picture.
 *
 * WOFF rather than WOFF2 because the shipped FFmpeg's FreeType reads the first
 * and refuses the second — measured, not assumed. The semibold weight is the
 * one that stays legible over arbitrary picture at small sizes.
 */

import burnInFontUrl from '@fontsource/inter/files/inter-latin-600-normal.woff';

export const VIDEO_BURN_IN_FONT_URL: string = burnInFontUrl;

type FetchLike = (input: string) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>;

/**
 * Fetch the font bytes for one burned-in delivery.
 *
 * The bundler resolves the URL, so this asks the app's own origin for a file it
 * already ships; there is no new runtime asset to publish and nothing to fetch
 * across origins.
 */
export async function loadVideoBurnInFont(
	fetchImpl: FetchLike | undefined = globalThis.fetch as FetchLike | undefined,
): Promise<Blob> {
	if (!VIDEO_BURN_IN_FONT_URL) throw new Error('The caption font is not part of this build.');
	if (typeof fetchImpl !== 'function') throw new Error('Loading the caption font needs fetch.');
	const response = await fetchImpl(VIDEO_BURN_IN_FONT_URL);
	if (!response.ok) throw new Error(`The caption font could not be loaded (${response.status}).`);
	return response.blob();
}
