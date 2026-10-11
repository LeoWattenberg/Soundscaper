/* SPDX-License-Identifier: AGPL-3.0-only */
import { addRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { MOTION_AUDIO_WINDOW_SAMPLES, validateMotionAudioWindow, type MotionAudioAsset, type MotionAudioFormat, type MotionAudioSampleProvider } from './motion-audio-contract.ts';
import type { MotionAmplitudeWindow } from './motion-expression-audio-capability.ts';

/** Integrate held native-sample energy, including exact fractional endpoints and zero beyond the source. */
export async function analyzeMotionAmplitudeWindow(options: Readonly<{
	window: MotionAmplitudeWindow; asset: MotionAudioAsset; format: MotionAudioFormat; provider: MotionAudioSampleProvider; signal: AbortSignal;
	work: { remaining: number };
}>): Promise<number> {
	const { window, asset, format, provider, signal } = options; signal.throwIfAborted();
	if (window.assetId !== asset.id || window.assetDigest !== asset.sha256) throw new RangeError('Amplitude analysis source digest is stale.');
	const half = divideRationals(window.windowSeconds, 2), start = multiplyRationals(subtractRationals(window.time, half), format.sampleRate), end = multiplyRationals(addRationals(window.time, half), format.sampleRate);
	const first = Math.max(0, Math.min(format.sampleCount, integer(start, 'floor'))), last = Math.max(0, Math.min(format.sampleCount, integer(end, 'ceil')));
	const count = Math.max(0, last - first);
	if (count > options.work.remaining) throw new RangeError('Audio amplitude native-sample analysis budget exceeded.'); options.work.remaining -= count;
	let energy = 0;
	for (let position = first; position < last; position += MOTION_AUDIO_WINDOW_SAMPLES) {
		signal.throwIfAborted(); const sampleCount = Math.min(MOTION_AUDIO_WINDOW_SAMPLES, last - position);
		const interleaved = await provider.read({ asset, startSample: position, sampleCount }, signal); signal.throwIfAborted(); validateMotionAudioWindow(interleaved, sampleCount, format);
		for (let offset = 0; offset < sampleCount; offset++) {
			const index = position + offset;
			const weight = index === first || index === last - 1 ? Math.max(0, Math.min(1, numeric(subtractRationals(end, index))) - Math.max(0, numeric(subtractRationals(start, index)))) : 1;
			let square = 0; for (let channel = 0; channel < format.channels; channel++) { const value = interleaved[offset * format.channels + channel]!; square += value * value; }
			energy += square / format.channels * weight;
		}
	}
	const result = Math.sqrt(energy / numeric(multiplyRationals(window.windowSeconds, format.sampleRate)));
	if (!Number.isFinite(result)) throw new RangeError('Audio amplitude analysis exceeded finite numeric headroom.'); return result;
}
function numeric(value: Rational): number { return value.num / value.den; }
function integer(value: Rational, rounding: 'floor' | 'ceil'): number {
	const numerator = BigInt(value.num), denominator = BigInt(value.den), quotient = numerator / denominator, remainder = numerator % denominator;
	return Number(quotient + (rounding === 'floor' && remainder < 0n ? -1n : rounding === 'ceil' && remainder > 0n ? 1n : 0n));
}
