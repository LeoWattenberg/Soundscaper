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
}

export interface VideoBurnInStage {
	readonly fontSizePx: number;
	readonly bottomMarginPx: number;
	readonly boxBorderPx: number;
	readonly lineSpacingPx: number;
	readonly cues: readonly VideoBurnInCue[];
}

interface BurnInCanvas {
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
	if (!Number.isSafeInteger(height) || height < 1) {
		throw new RangeError('A burn-in stage needs a positive canvas height.');
	}
	const drawn = cues.filter((cue) => String(cue.title ?? '').trim().length > 0);
	if (drawn.length === 0) return null;
	if (drawn.length > VIDEO_BURN_IN_MAXIMUM_CUES) {
		throw new RangeError(
			`A burned-in delivery may carry at most ${VIDEO_BURN_IN_MAXIMUM_CUES} cues; this one has ${drawn.length}.`,
		);
	}
	const fontSizePx = Math.max(
		VIDEO_BURN_IN_MINIMUM_FONT_SIZE,
		Math.round(height * VIDEO_BURN_IN_FONT_HEIGHT_FRACTION),
	);
	return Object.freeze({
		fontSizePx,
		bottomMarginPx: Math.round(height * VIDEO_BURN_IN_TITLE_SAFE_FRACTION),
		boxBorderPx: Math.max(2, Math.round(fontSizePx * 0.25)),
		lineSpacingPx: Math.round(fontSizePx * 0.25),
		cues: Object.freeze(drawn.map((cue, index) => Object.freeze({
			index,
			startSeconds: cue.startFrame / sampleRate,
			endSeconds: cue.endFrame / sampleRate,
			text: burnInText(cue.title),
		}))),
	});
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
