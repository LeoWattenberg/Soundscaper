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
 *
 * Inter ships as unicode subsets, and only one file can be handed to `drawtext`
 * at a time: this build has no fontconfig, so there is no font fallback to lean
 * on — measured, `drawtext=font=Inter` fails to initialize at all. Staging the
 * Latin subset alone therefore drew every Cyrillic and Greek caption as blanks.
 * The subset is now chosen per cue from the characters that cue actually
 * contains, out of the same seven files the interface already loads.
 *
 * What that cannot fix, and what the delivery report therefore says out loud: a
 * script whose letters live in one subset and whose punctuation lives in another
 * — Latin-extended and Vietnamese both do, since their accented forms sit
 * outside the Latin subset — cannot be drawn whole from any single file. Those
 * characters come back as `undrawable` and the report names them. Drawing them
 * needs a font with combined coverage, which is a dependency decision rather
 * than something this module can resolve.
 */

import cyrillicExtUrl from '@fontsource/inter/files/inter-cyrillic-ext-600-normal.woff';
import cyrillicUrl from '@fontsource/inter/files/inter-cyrillic-600-normal.woff';
import greekExtUrl from '@fontsource/inter/files/inter-greek-ext-600-normal.woff';
import greekUrl from '@fontsource/inter/files/inter-greek-600-normal.woff';
import latinExtUrl from '@fontsource/inter/files/inter-latin-ext-600-normal.woff';
import latinUrl from '@fontsource/inter/files/inter-latin-600-normal.woff';
import vietnameseUrl from '@fontsource/inter/files/inter-vietnamese-600-normal.woff';

export interface VideoBurnInFontSubset {
	readonly id: string;
	readonly url: string;
	/** Inclusive code-point ranges, exactly as the font's own stylesheet states them. */
	readonly ranges: readonly (readonly [number, number])[];
}

const range = (from: number, to: number = from): readonly [number, number] => Object.freeze([from, to] as const);

/**
 * The subsets, in the order a tie is broken.
 *
 * Latin leads because it carries the punctuation and spacing every caption uses
 * whatever its script, so a cue that is mostly ASCII stays on the file that
 * draws ASCII best. The ranges are copied from `@fontsource/inter/600.css` and a
 * test reads that stylesheet back to keep the copy honest.
 */
export const VIDEO_BURN_IN_FONT_SUBSETS: readonly VideoBurnInFontSubset[] = Object.freeze([
	Object.freeze({
		id: 'latin',
		url: latinUrl,
		ranges: Object.freeze([
			range(0x0000, 0x00ff), range(0x0131), range(0x0152, 0x0153), range(0x02bb, 0x02bc),
			range(0x02c6), range(0x02da), range(0x02dc), range(0x0304), range(0x0308), range(0x0329),
			range(0x2000, 0x206f), range(0x20ac), range(0x2122), range(0x2191), range(0x2193),
			range(0x2212), range(0x2215), range(0xfeff), range(0xfffd),
		]),
	}),
	Object.freeze({
		id: 'latin-ext',
		url: latinExtUrl,
		ranges: Object.freeze([
			range(0x0100, 0x02ba), range(0x02bd, 0x02c5), range(0x02c7, 0x02cc), range(0x02ce, 0x02d7),
			range(0x02dd, 0x02ff), range(0x0304), range(0x0308), range(0x0329), range(0x1d00, 0x1dbf),
			range(0x1e00, 0x1e9f), range(0x1ef2, 0x1eff), range(0x2020), range(0x20a0, 0x20ab),
			range(0x20ad, 0x20c0), range(0x2113), range(0x2c60, 0x2c7f), range(0xa720, 0xa7ff),
		]),
	}),
	Object.freeze({
		id: 'cyrillic',
		url: cyrillicUrl,
		ranges: Object.freeze([
			range(0x0301), range(0x0400, 0x045f), range(0x0490, 0x0491), range(0x04b0, 0x04b1),
			range(0x2116),
		]),
	}),
	Object.freeze({
		id: 'cyrillic-ext',
		url: cyrillicExtUrl,
		ranges: Object.freeze([
			range(0x0460, 0x052f), range(0x1c80, 0x1c8a), range(0x20b4), range(0x2de0, 0x2dff),
			range(0xa640, 0xa69f), range(0xfe2e, 0xfe2f),
		]),
	}),
	Object.freeze({
		id: 'greek',
		url: greekUrl,
		ranges: Object.freeze([
			range(0x0370, 0x0377), range(0x037a, 0x037f), range(0x0384, 0x038a), range(0x038c),
			range(0x038e, 0x03a1), range(0x03a3, 0x03ff),
		]),
	}),
	Object.freeze({
		id: 'greek-ext',
		url: greekExtUrl,
		ranges: Object.freeze([range(0x1f00, 0x1fff)]),
	}),
	Object.freeze({
		id: 'vietnamese',
		url: vietnameseUrl,
		ranges: Object.freeze([
			range(0x0102, 0x0103), range(0x0110, 0x0111), range(0x0128, 0x0129), range(0x0168, 0x0169),
			range(0x01a0, 0x01a1), range(0x01af, 0x01b0), range(0x0300, 0x0301), range(0x0303, 0x0304),
			range(0x0308, 0x0309), range(0x0323), range(0x0329), range(0x1ea0, 0x1ef9), range(0x20ab),
		]),
	}),
]);

export const VIDEO_BURN_IN_DEFAULT_FONT_SUBSET = 'latin';

const SUBSETS_BY_ID: ReadonlyMap<string, VideoBurnInFontSubset> = new Map(
	VIDEO_BURN_IN_FONT_SUBSETS.map((subset) => [subset.id, subset]),
);

export function videoBurnInFontSubset(id: unknown): VideoBurnInFontSubset | null {
	return typeof id === 'string' ? SUBSETS_BY_ID.get(id) ?? null : null;
}

export interface VideoBurnInFontChoice {
	readonly subsetId: string;
	/** Characters this subset cannot draw, deduplicated and in first-seen order. */
	readonly undrawable: readonly string[];
}

/**
 * The subset one cue is drawn with, and what it still cannot draw.
 *
 * The subset that leaves the fewest characters undrawn wins, and ties go to the
 * catalog order, which puts Latin first. Counting what is missing rather than
 * what is covered is what makes a Cyrillic line with Latin punctuation land on
 * the Cyrillic file: covering the most characters would have picked Latin and
 * blanked every word.
 *
 * What one file cannot draw is returned rather than silently blanked, so the
 * delivery report can name it.
 */
export function resolveVideoBurnInFontChoice(text: unknown): VideoBurnInFontChoice {
	const characters = [...String(text ?? '')].filter((character) => !/\s/u.test(character));
	let best = VIDEO_BURN_IN_FONT_SUBSETS[0]!;
	let fewestMissing = Number.POSITIVE_INFINITY;
	for (const subset of VIDEO_BURN_IN_FONT_SUBSETS) {
		const missing = characters.filter((character) => !subsetCovers(subset, character)).length;
		if (missing < fewestMissing) {
			best = subset;
			fewestMissing = missing;
		}
	}
	const undrawable: string[] = [];
	for (const character of characters) {
		if (subsetCovers(best, character) || undrawable.includes(character)) continue;
		undrawable.push(character);
	}
	return Object.freeze({ subsetId: best.id, undrawable: Object.freeze(undrawable) });
}

function subsetCovers(subset: VideoBurnInFontSubset, character: string): boolean {
	const code = character.codePointAt(0) ?? -1;
	return subset.ranges.some(([from, to]) => code >= from && code <= to);
}

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
		const subset = videoBurnInFontSubset(id)!;
		// The bundler resolves each URL at build time, so a missing file is a build
		// failure rather than something to guard for here; what this does have to
		// say is which subset failed, since a delivery may need several.
		const response = await fetchImpl(subset.url);
		if (!response.ok) {
			throw new Error(`The ${id} caption font could not be loaded (${response.status}).`);
		}
		loaded.set(id, await response.blob());
	}
	return loaded;
}
