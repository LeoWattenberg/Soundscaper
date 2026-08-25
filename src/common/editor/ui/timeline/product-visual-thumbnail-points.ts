/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProductVisualThumbnailPoint {
	readonly gridIndex: number;
	readonly timelineFrame: number;
	readonly sourceFrame: 0;
	readonly sourceTimeSeconds: number;
}

/** Select bounded timeline sample points for a product-owned image clip. */
export function selectProductVisualThumbnailPoints(options: Readonly<{
	readonly clip: unknown;
	readonly visibleStartFrame: unknown;
	readonly visibleEndFrame: unknown;
	readonly projectSampleRate: unknown;
	readonly pixelsPerSecond: unknown;
	readonly baseIntervalSeconds?: unknown;
	readonly minimumSpacingPixels?: unknown;
}>): readonly Readonly<ProductVisualThumbnailPoint>[] {
	const clip = record(options?.clip, 'product visual clip');
	if (clip.kind !== 'image') throw new TypeError('Product visual thumbnail points require an image clip.');
	const clipStart = nonNegativeInteger(clip.timelineStartFrame, 'image clip timeline start');
	const clipDuration = positiveInteger(clip.durationFrames, 'image clip duration');
	const clipEnd = clipStart + clipDuration;
	if (!Number.isSafeInteger(clipEnd)) throw new RangeError('Image clip timeline end exceeds exact integers.');
	const visibleStart = Math.max(
		clipStart, nonNegativeInteger(options.visibleStartFrame, 'visible start frame'),
	);
	const visibleEnd = Math.min(
		clipEnd, nonNegativeInteger(options.visibleEndFrame, 'visible end frame'),
	);
	if (visibleEnd <= visibleStart) return Object.freeze([]);
	const sampleRate = positiveInteger(options.projectSampleRate, 'project sample rate');
	const pixelsPerSecond = positiveFinite(options.pixelsPerSecond, 'pixels per second');
	const baseInterval = positiveFinite(options.baseIntervalSeconds ?? 5, 'base interval seconds');
	const minimumSpacing = positiveFinite(options.minimumSpacingPixels ?? 72, 'minimum spacing pixels');
	const intervalFrames = Math.max(
		1,
		Math.ceil(sampleRate * baseInterval),
		Math.ceil(sampleRate * minimumSpacing / pixelsPerSecond),
	);
	const points: ProductVisualThumbnailPoint[] = [];
	for (let frame = visibleStart, gridIndex = 0; frame < visibleEnd; frame += intervalFrames, gridIndex += 1) {
		points.push(Object.freeze({
			gridIndex,
			timelineFrame: frame,
			sourceFrame: 0,
			sourceTimeSeconds: (frame - clipStart) / sampleRate,
		}));
	}
	return Object.freeze(points);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be positive.`);
	}
	return value;
}
