/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Audacity's compressor/limiter static transfer curve, using the same soft-knee
 * gain reduction as audacity-effects/live-dynamics-processors.js. Coordinates
 * follow CompressionCurvePainter.qml: -36..0 dB input and output, with the area
 * below the output filled down to the graph floor.
 */

export interface AudacityCompressionCurve {
	readonly line: string;
	readonly area: string;
}

const MIN_DB = -36;
const RANGE_DB = 36;
const SAMPLE_COUNT = 200;

function parameter(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function coordinate(value: number): string {
	return String(Number(value.toFixed(4)));
}

/** SVG paths for an Audacity transfer graph with viewBox="0 0 100 100". */
export function audacityCompressionCurve(
	parameters: Readonly<Record<string, unknown>>,
	options: { readonly limiter?: boolean } = {},
): AudacityCompressionCurve {
	const limiter = options.limiter === true;
	const threshold = parameter(parameters.thresholdDb, limiter ? -6 : -12, limiter ? -30 : -60, 0);
	const knee = parameter(parameters.kneeWidthDb, limiter ? 2 : 6, 0, limiter ? 10 : 30);
	const ratio = parameter(parameters.ratio, 4, 1, 100);
	const makeup = limiter
		? parameter(parameters.makeupTargetDb, -1, -30, 0) - threshold
		: parameter(parameters.makeupGainDb, 9, -30, 30);
	const slope = limiter ? -1 : 1 / ratio - 1;
	const halfKnee = knee / 2;
	const points: string[] = [];
	for (let index = 0; index < SAMPLE_COUNT; index += 1) {
		const x = index / (SAMPLE_COUNT - 1);
		const input = MIN_DB + x * RANGE_DB;
		const overshoot = input - threshold;
		let reduction = 0;
		if (overshoot > halfKnee) reduction = slope * overshoot;
		else if (overshoot > -halfKnee && knee > 0) {
			reduction = 0.5 * slope * (overshoot + halfKnee) ** 2 / knee;
		}
		const output = input + reduction + makeup;
		points.push(`${coordinate(x * 100)} ${coordinate(100 - (output - MIN_DB) / RANGE_DB * 100)}`);
	}
	return {
		line: `M ${points.join(' L ')}`,
		area: `M 0 100 L ${points.join(' L ')} L 100 100 Z`,
	};
}
