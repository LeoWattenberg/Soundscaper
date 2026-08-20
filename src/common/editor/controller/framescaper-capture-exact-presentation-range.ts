/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperCaptureExactPresentationRange = `${bigint}:${bigint}`;

/** Canonical byte-comparable evidence for the manifest's exact active-time range. */
export function createFramescaperCaptureExactPresentationRange(
	firstMicroseconds: number,
	endMicroseconds: number,
): FramescaperCaptureExactPresentationRange {
	const first = nonNegativeInteger(firstMicroseconds, 'Capture first presentation microsecond');
	const end = nonNegativeInteger(endMicroseconds, 'Capture presentation end microsecond');
	if (end <= first) throw new RangeError('Capture exact presentation range must have positive duration.');
	return `${String(first)}:${String(end)}` as FramescaperCaptureExactPresentationRange;
}

export function normalizeFramescaperCaptureExactPresentationRange(
	value: unknown,
): FramescaperCaptureExactPresentationRange | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/u.test(value)) {
		throw new TypeError('Capture exact presentation range is not canonical.');
	}
	const [first, end] = value.split(':').map(Number);
	return createFramescaperCaptureExactPresentationRange(first, end);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
