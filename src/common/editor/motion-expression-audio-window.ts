/* SPDX-License-Identifier: AGPL-3.0-only */
import { addRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { MOTION_AUDIO_WINDOW_SAMPLES, type MotionAudioAsset, type MotionAudioFormat } from './motion-audio-contract.ts';
import type { MotionAmplitudeNativeCache, MotionAmplitudeNativeBudget } from './motion-expression-audio-energy.ts';
import type { MotionAmplitudeWindow } from './motion-expression-audio-capability.ts';

/** Integrate held native-sample energy, including exact fractional endpoints and zero beyond the source. */
export async function analyzeMotionAmplitudeWindow(options: Readonly<{
	window: MotionAmplitudeWindow; asset: MotionAudioAsset; format: MotionAudioFormat; cache: MotionAmplitudeNativeCache; signal: AbortSignal;
	work: MotionAmplitudeNativeBudget;
}>): Promise<number> {
	const { window, asset, format, cache, signal } = options; signal.throwIfAborted();
	if (window.assetId !== asset.id || window.assetDigest !== asset.sha256) throw new RangeError('Amplitude analysis source digest is stale.');
	const half = divideRationals(window.windowSeconds, 2), start = multiplyRationals(subtractRationals(window.time, half), format.sampleRate), end = multiplyRationals(addRationals(window.time, half), format.sampleRate);
	const first = Math.max(0, Math.min(format.sampleCount, integer(start, 'floor'))), last = Math.max(0, Math.min(format.sampleCount, integer(end, 'ceil')));
	let energy = 0;
	const weight = (index: number) => Math.max(0, Math.min(1, numeric(subtractRationals(end, index))) - Math.max(0, numeric(subtractRationals(start, index))));
	for (let position = first; position < last;) {
		signal.throwIfAborted(); const blockStart = Math.floor(position / MOTION_AUDIO_WINDOW_SAMPLES) * MOTION_AUDIO_WINDOW_SAMPLES;
		const block = await cache.read(asset, format, blockStart, signal, options.work); signal.throwIfAborted();
		const stop = Math.min(last, block.first + block.count);
		if (position === first) energy += block.sum(first - block.first, first - block.first + 1) * weight(first);
		if (stop === last && last - 1 !== first) energy += block.sum(last - 1 - block.first, last - block.first) * weight(last - 1);
		const innerFirst = Math.max(position, first + 1), innerEnd = Math.min(stop, last - 1);
		if (innerFirst < innerEnd) energy += block.sum(innerFirst - block.first, innerEnd - block.first);
		position = stop;
	}
	const result = Math.sqrt(energy / numeric(multiplyRationals(window.windowSeconds, format.sampleRate)));
	if (!Number.isFinite(result)) throw new RangeError('Audio amplitude analysis exceeded finite numeric headroom.'); return result;
}
function numeric(value: Rational): number { return value.num / value.den; }
function integer(value: Rational, rounding: 'floor' | 'ceil'): number {
	const numerator = BigInt(value.num), denominator = BigInt(value.den), quotient = numerator / denominator, remainder = numerator % denominator;
	return Number(quotient + (rounding === 'floor' && remainder < 0n ? -1n : rounding === 'ceil' && remainder > 0n ? 1n : 0n));
}
