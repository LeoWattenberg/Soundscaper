/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from '../video-retime-v16.ts';

export const VIDEO_RETIME_EXACT_MAP_INPUT_MAX_LENGTH = 2_000_000;

export interface VideoRetimeExactMapBounds {
	readonly outerFrameCount: number;
	readonly sourceFirstFrame: number;
	readonly sourceLastFrame: number;
}

/** Parse one bounded JSON wire through the maintained clip-bound V2 retime validator. */
export function parseVideoRetimeExactMapInput(
	text: string,
	bounds: VideoRetimeExactMapBounds,
): VideoRetimeCurveV16 {
	if (text.trim().length === 0) throw new RangeError('Exact retime map must be a JSON object.');
	if (text.length > VIDEO_RETIME_EXACT_MAP_INPUT_MAX_LENGTH) {
		throw new RangeError('Exact retime map exceeds the supported input size.');
	}
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new SyntaxError('Exact retime map must be valid JSON.', { cause: error });
	}
	const normalized = normalizeVideoRetimeCurveV16(value, binding(bounds));
	if (normalized === null) throw new TypeError('Exact retime map must be a V2 map, not null.');
	return normalized;
}

/** Seed the dialog with the current exact map, or a canonical forward map for an unretimed clip. */
export function formatVideoRetimeExactMapInput(
	value: unknown,
	bounds: VideoRetimeExactMapBounds,
): string {
	const candidate = value === null ? {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: bounds.sourceFirstFrame, den: 1 } },
			{ outerFrame: bounds.outerFrameCount, sourceFrame: { num: bounds.sourceLastFrame, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	} : value;
	const normalized = normalizeVideoRetimeCurveV16(candidate, binding(bounds));
	if (normalized === null) throw new TypeError('Exact retime map must be a V2 map, not null.');
	return JSON.stringify(normalized, null, '\t');
}

function binding(bounds: VideoRetimeExactMapBounds): Readonly<{
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}> {
	return Object.freeze({
		sequenceFrameCount: bounds.outerFrameCount,
		sourceInFrame: bounds.sourceFirstFrame,
		sourceFrameCount: bounds.sourceLastFrame - bounds.sourceFirstFrame,
	});
}
