/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Burning label-track cues into the delivered picture.
 *
 * The presentation here is one fixed constant, not a schema: a single weight of
 * one bundled font, white on a translucent box, centred in the bottom
 * title-safe band. Milestone 4 owns styled captions and has not delivered them,
 * so inventing a styling vocabulary now would mean maintaining two — this one
 * and the real one — and migrating between them. When that schema lands, this
 * module consumes it and these constants retire; the seam is deliberately this
 * whole file rather than a flag inside it.
 *
 * Two decisions here were settled by measuring the shipped FFmpeg build rather
 * than by preference. Its libass has no font provider — the `subtitles` filter
 * exits zero and draws nothing at all — so burn-in goes through `drawtext` with
 * a font staged explicitly. And its FreeType reads WOFF but not WOFF2, so the
 * staged font is the WOFF the design system already ships.
 */

import { resolveVideoBurnInFontChoice } from './video-burn-in-font.ts';

/**
 * The bottom band captions stay out of, as a fraction of canvas height.
 *
 * Ten per cent is the title-safe convention, which is where broadcast text has
 * always gone; action-safe five per cent would put a caption closer to an edge
 * a set-top box may crop.
 */
export const VIDEO_BURN_IN_TITLE_SAFE_FRACTION = 0.1;

/** Cap height as a fraction of canvas height: legible at 720p, not shouting at 4K. */
export const VIDEO_BURN_IN_FONT_HEIGHT_FRACTION = 0.045;

/**
 * The side margin a burned line keeps, as a fraction of canvas width per side.
 *
 * Captions were placed against height alone, and `drawtext` neither wraps nor
 * clips: a line wider than the frame simply drew off both edges. On the
 * catalog's own 1080x1920 target that started at 28 characters, which is below
 * any real subtitle line, so the width is a bound here rather than an accident
 * of how tall the delivery happens to be.
 */
export const VIDEO_BURN_IN_SIDE_MARGIN_FRACTION = 0.05;

/**
 * The line length the type is sized against.
 *
 * Broadcast subtitle practice runs to about 32-42 characters a line, so sizing
 * the type so that 32 fit inside the safe width keeps a normal caption on one
 * line at any aspect, and leaves the height rule in charge wherever it is the
 * tighter of the two — which is every 16:9 delivery, whose type is unchanged.
 */
export const VIDEO_BURN_IN_REFERENCE_LINE_CHARACTERS = 32;

/**
 * Advance per character as a fraction of font size, for this font at this weight.
 *
 * Measured against the staged Inter semibold through the shipped runtime: a
 * 44-character line drew 1884 px at fontsize 86 and 685 px at fontsize 32, both
 * an advance of about 0.5. The value used here is deliberately wider than the
 * measurement, because the measurement is an average over mixed-case prose and
 * a line of capitals is wider than its average.
 */
export const VIDEO_BURN_IN_CHARACTER_ADVANCE_RATIO = 0.55;

/** Below this the glyphs stop being glyphs, so a tiny canvas gets a floor instead. */
export const VIDEO_BURN_IN_MINIMUM_FONT_SIZE = 12;

/**
 * How many cues one delivery may burn in.
 *
 * Each cue is its own `drawtext` filter, because a filter's text is fixed for
 * the whole graph and only its `enable` expression varies. The bound is what
 * keeps a filter graph a filter graph; a delivery past it is refused with the
 * number rather than left to produce a command no runtime will parse.
 */
export const VIDEO_BURN_IN_MAXIMUM_CUES = 2_000;

/** A caption line is a caption line; past this it is a document. */
export const VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH = 500;

export interface VideoBurnInCue {
	readonly index: number;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly text: string;
	/** The font subset this cue's characters are drawn from. */
	readonly fontSubset: string;
	/** Characters that subset cannot draw, which the delivery report states. */
	readonly undrawable: readonly string[];
}

export interface VideoBurnInStage {
	readonly fontSizePx: number;
	readonly bottomMarginPx: number;
	readonly boxBorderPx: number;
	readonly lineSpacingPx: number;
	readonly cues: readonly VideoBurnInCue[];
}

interface BurnInCanvas {
	readonly width: number;
	readonly height: number;
}

interface SourceCue {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly title: string;
}

/**
 * The burn-in stage for one delivery, or null when nothing is burned in.
 *
 * Cue times arrive as sample frames scoped to the delivered range and leave as
 * seconds on the output timeline, because that is what the render stage can
 * gate on: the composed picture starts at zero however far into the project the
 * range began.
 *
 * A cue with no text is dropped rather than drawn, since an empty label would
 * otherwise paint a bare box over the picture for its duration.
 */
export function resolveVideoBurnInStage(
	cues: readonly SourceCue[],
	canvas: BurnInCanvas,
	sampleRate: number,
): VideoBurnInStage | null {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) {
		throw new RangeError('A burn-in stage needs the project sample rate its cues are counted in.');
	}
	const height = canvas.height;
	const width = canvas.width;
	if (!Number.isSafeInteger(height) || height < 1) {
		throw new RangeError('A burn-in stage needs a positive canvas height.');
	}
	if (!Number.isSafeInteger(width) || width < 1) {
		throw new RangeError('A burn-in stage needs a positive canvas width.');
	}
	// A cue with no time on screen is not a caption anyone can read, and drawing
	// one is what let two captions share a frame: `enable` windows are closed at
	// both ends, so a cue ending exactly where the next begins drew both on the
	// frame they touch, one over the other.
	const drawn = cues.filter((cue) => (
		String(cue.title ?? '').trim().length > 0 && cue.endFrame > cue.startFrame
	));
	if (drawn.length === 0) return null;
	if (drawn.length > VIDEO_BURN_IN_MAXIMUM_CUES) {
		throw new RangeError(
			`A burned-in delivery may carry at most ${VIDEO_BURN_IN_MAXIMUM_CUES} cues; this one has ${drawn.length}.`,
		);
	}
	const safeWidth = width * (1 - 2 * VIDEO_BURN_IN_SIDE_MARGIN_FRACTION);
	const widthFontSize = Math.floor(
		safeWidth / (VIDEO_BURN_IN_REFERENCE_LINE_CHARACTERS * VIDEO_BURN_IN_CHARACTER_ADVANCE_RATIO),
	);
	const fontSizePx = Math.max(
		VIDEO_BURN_IN_MINIMUM_FONT_SIZE,
		Math.min(Math.round(height * VIDEO_BURN_IN_FONT_HEIGHT_FRACTION), widthFontSize),
	);
	const charactersPerLine = Math.max(
		1,
		Math.floor(safeWidth / (fontSizePx * VIDEO_BURN_IN_CHARACTER_ADVANCE_RATIO)),
	);
	return Object.freeze({
		fontSizePx,
		bottomMarginPx: Math.round(height * VIDEO_BURN_IN_TITLE_SAFE_FRACTION),
		boxBorderPx: Math.max(2, Math.round(fontSizePx * 0.25)),
		lineSpacingPx: Math.round(fontSizePx * 0.25),
		cues: Object.freeze(drawn.map((cue, index) => {
			const text = wrapBurnInText(burnInText(cue.title), charactersPerLine);
			const font = resolveVideoBurnInFontChoice(text);
			return Object.freeze({
				index,
				startSeconds: cue.startFrame / sampleRate,
				endSeconds: cue.endFrame / sampleRate,
				text,
				fontSubset: font.subsetId,
				undrawable: font.undrawable,
			});
		})),
	});
}

/**
 * Break a caption into lines the frame can hold.
 *
 * `drawtext` draws exactly what it is given on one line unless the text itself
 * carries newlines, so the wrapping happens here or not at all. Words are kept
 * whole where they fit and split where a single word is wider than the frame,
 * because a word that cannot be broken would otherwise run off the edge that
 * this bound exists to keep it inside.
 */
function wrapBurnInText(text: string, charactersPerLine: number): string {
	return text.split('\n').map((paragraph) => wrapParagraph(paragraph, charactersPerLine)).join('\n');
}

function wrapParagraph(paragraph: string, charactersPerLine: number): string {
	const lines: string[] = [];
	let line = '';
	for (const word of paragraph.split(/\s+/u).filter((value) => value.length > 0)) {
		let remaining = word;
		while (remaining.length > charactersPerLine) {
			if (line.length > 0) {
				lines.push(line);
				line = '';
			}
			lines.push(remaining.slice(0, charactersPerLine));
			remaining = remaining.slice(charactersPerLine);
		}
		if (line.length === 0) line = remaining;
		else if (line.length + 1 + remaining.length <= charactersPerLine) line = `${line} ${remaining}`;
		else {
			lines.push(line);
			line = remaining;
		}
	}
	if (line.length > 0) lines.push(line);
	return lines.length > 0 ? lines.join('\n') : paragraph.trim();
}

/** Whether any two burned cues are on screen at once, which the report says out loud. */
export function videoBurnInCuesOverlap(stage: VideoBurnInStage | null): boolean {
	const cues = [...(stage?.cues ?? [])].sort((left, right) => left.startSeconds - right.startSeconds);
	return cues.some((cue, index) => index > 0 && cue.startSeconds < cues[index - 1]!.endSeconds);
}

function burnInText(value: unknown): string {
	const text = String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
	if (text.length > VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH) {
		throw new RangeError(
			`A burned-in cue may carry at most ${VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH} characters.`,
		);
	}
	if (text.includes('\0')) throw new RangeError('A burned-in cue cannot contain a NUL character.');
	return text;
}

/** The font subsets a stage needs staged, in the order they are first drawn. */
export function videoBurnInFontSubsetIds(stage: VideoBurnInStage | null): readonly string[] {
	const ids: string[] = [];
	for (const cue of stage?.cues ?? []) {
		if (!ids.includes(cue.fontSubset)) ids.push(cue.fontSubset);
	}
	return Object.freeze(ids);
}

/** Every character a burned delivery could not draw, deduplicated across its cues. */
export function videoBurnInUndrawableCharacters(stage: VideoBurnInStage | null): readonly string[] {
	const characters: string[] = [];
	for (const cue of stage?.cues ?? []) {
		for (const character of cue.undrawable) {
			if (!characters.includes(character)) characters.push(character);
		}
	}
	return Object.freeze(characters);
}
