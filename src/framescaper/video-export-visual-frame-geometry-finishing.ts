/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoKeyframeExportFrame } from '../common/editor/video-keyframe-export-frame-source.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';

export function framescaperVisualSequencePositionFinishing(
	frame: VideoKeyframeExportFrame,
	plan: UnifiedExactRenderPlanV13,
) {
	const numerator = BigInt(frame.timelinePosition.num) * BigInt(plan.timebase.sequenceRate.num);
	const denominator = BigInt(frame.timelinePosition.den) * BigInt(plan.timebase.sampleRate)
		* BigInt(plan.timebase.sequenceRate.den);
	const divisor = gcd(numerator, denominator);
	const num = Number(numerator / divisor);
	const den = Number(denominator / divisor);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('finishing visual sequence position exceeds its exact domain.');
	}
	return Object.freeze({ num, den });
}

export function fillFramescaperVisualBackgroundFinishing(
	target: Uint8Array<ArrayBuffer>,
	canvasValue: unknown,
	width: number,
	height: number,
): void {
	if (target.byteLength !== width * height * 4) throw new RangeError('finishing visual output geometry changed.');
	const color = String(record(canvasValue, 'finishing visual canvas').backgroundColor);
	if (!/^#[a-fA-F0-9]{6}$/u.test(color)) throw new TypeError('finishing visual background is invalid.');
	const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
	for (let offset = 0; offset < target.length; offset += 4) {
		target[offset] = rgb[0]!; target[offset + 1] = rgb[1]!;
		target[offset + 2] = rgb[2]!; target[offset + 3] = 255;
	}
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function gcd(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}
