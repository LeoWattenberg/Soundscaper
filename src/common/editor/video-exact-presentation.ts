/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ExactVideoPresentationMapping {
	readonly timelineFrame: number;
	readonly timelineTimeSeconds: number;
	readonly localTimelineFrame: null;
	readonly progress: null;
	readonly sourceFrame: number;
	readonly sourceTimeSeconds: number;
}

/** Convert a validated exact frame descriptor only at the HTML-media boundary. */
export function createExactVideoPresentationMapping(
	descriptor: unknown,
	timelineFrame: number,
	sampleRate: number,
): Readonly<ExactVideoPresentationMapping> {
	const value = record(descriptor, 'video presentation descriptor');
	const sourceFrame = exactNumber(value.sourceFrame, 'video presentation sourceFrame');
	// The HTML-media seek target must sit inside the drawable frame's
	// half-open interval: a reverse cell's exact source time equals the
	// interval's exclusive end, and seeking that boundary presents the next
	// frame instead of the picture the exact route delivers.
	const interior = drawableInteriorSeconds(value);
	const sourceTimeSeconds = interior ?? exactNumber(value.sourceTime, 'video presentation sourceTime');
	return Object.freeze({
		timelineFrame,
		timelineTimeSeconds: timelineFrame / sampleRate,
		localTimelineFrame: null,
		progress: null,
		sourceFrame,
		sourceTimeSeconds,
	});
}

function drawableInteriorSeconds(value: Readonly<Record<string, unknown>>): number | null {
	const start = optionalExactSeconds(value.drawableSourceStartTime);
	const end = optionalExactSeconds(value.drawableSourceEndTime);
	if (start === null || end === null || !(start < end)) return null;
	const midpoint = (start + end) / 2;
	return midpoint >= start && midpoint < end ? midpoint : start;
}

function optionalExactSeconds(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const rational = value as Readonly<{ numerator?: unknown; denominator?: unknown }>;
	if (typeof rational.numerator !== 'bigint' || typeof rational.denominator !== 'bigint'
		|| rational.denominator <= 0n) return null;
	const result = Number(rational.numerator) / Number(rational.denominator);
	return Number.isFinite(result) ? result : null;
}

function exactNumber(value: unknown, name: string): number {
	const rational = record(value, name);
	if (typeof rational.numerator !== 'bigint' || typeof rational.denominator !== 'bigint'
		|| rational.denominator <= 0n) throw new TypeError(`${name} must be an exact rational.`);
	const result = Number(rational.numerator) / Number(rational.denominator);
	if (!Number.isFinite(result)) throw new RangeError(`${name} exceeds the browser numeric range.`);
	return result;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
