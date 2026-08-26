/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which slice of Inter can draw a given caption.
 *
 * Kept apart from the font files themselves because this is data and a rule,
 * while the files are bundled assets: the plan builder, the native admission and
 * the delivery report all need the rule, and none of them should pull a WOFF2
 * into their module graph to get it.
 *
 * Inter ships as unicode subsets, and only one file can be handed to `drawtext`
 * at a time: this build has no fontconfig, so there is no font fallback to lean
 * on — measured, `drawtext=font=Inter` fails to initialize at all. Staging the
 * Latin subset alone therefore drew every Cyrillic caption as blanks.
 *
 * What choosing per cue cannot fix, and what the delivery report therefore says
 * out loud: a script whose letters live in one subset and whose accents live in
 * another — Latin-extended and Vietnamese both do — cannot be drawn whole from
 * any single file. Those characters come back as `undrawable`. Drawing them
 * needs a font with combined coverage, which is a dependency decision rather
 * than something this module can settle.
 */

export interface VideoBurnInFontSubset {
	readonly id: string;
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
		ranges: Object.freeze([
			range(0x0000, 0x00ff), range(0x0131), range(0x0152, 0x0153), range(0x02bb, 0x02bc),
			range(0x02c6), range(0x02da), range(0x02dc), range(0x0304), range(0x0308), range(0x0329),
			range(0x2000, 0x206f), range(0x20ac), range(0x2122), range(0x2191), range(0x2193),
			range(0x2212), range(0x2215), range(0xfeff), range(0xfffd),
		]),
	}),
	Object.freeze({
		id: 'latin-ext',
		ranges: Object.freeze([
			range(0x0100, 0x02ba), range(0x02bd, 0x02c5), range(0x02c7, 0x02cc), range(0x02ce, 0x02d7),
			range(0x02dd, 0x02ff), range(0x0304), range(0x0308), range(0x0329), range(0x1d00, 0x1dbf),
			range(0x1e00, 0x1e9f), range(0x1ef2, 0x1eff), range(0x2020), range(0x20a0, 0x20ab),
			range(0x20ad, 0x20c0), range(0x2113), range(0x2c60, 0x2c7f), range(0xa720, 0xa7ff),
		]),
	}),
	Object.freeze({
		id: 'cyrillic',
		ranges: Object.freeze([
			range(0x0301), range(0x0400, 0x045f), range(0x0490, 0x0491), range(0x04b0, 0x04b1),
			range(0x2116),
		]),
	}),
	Object.freeze({
		id: 'cyrillic-ext',
		ranges: Object.freeze([
			range(0x0460, 0x052f), range(0x1c80, 0x1c8a), range(0x20b4), range(0x2de0, 0x2dff),
			range(0xa640, 0xa69f), range(0xfe2e, 0xfe2f),
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
