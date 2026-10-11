/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_AUDIO_WINDOW_SAMPLES, validateMotionAudioWindow, type MotionAudioAsset, type MotionAudioFormat, type MotionAudioSampleProvider } from './motion-audio-contract.ts';
import { motionInteger } from './motion-values.ts';

export interface MotionAmplitudeNativeBudget { readonly remaining: number; consume(samples: number): void }
export function createMotionAmplitudeNativeBudget(maximumSamples = 1_048_576): MotionAmplitudeNativeBudget {
	let remaining = motionInteger(maximumSamples, 'amplitude native work samples', 1, 16_777_216);
	return Object.freeze({ get remaining() { return remaining; }, consume(samples: number) {
		if (!Number.isSafeInteger(samples) || samples < 0 || samples > remaining) throw new RangeError('Audio amplitude native-sample analysis budget exceeded.'); remaining -= samples;
	} });
}

interface EnergyBlock { readonly first: number; readonly count: number; readonly bytes: number; sum(first: number, end: number): number }
export interface MotionAmplitudeNativeCache {
	readonly bytes: number; readonly size: number;
	read(asset: MotionAudioAsset, format: MotionAudioFormat, first: number, signal: AbortSignal, work: MotionAmplitudeNativeBudget): Promise<EnergyBlock>;
	clear(): void;
}
/** Positive range sums retain tiny windows beside loud excluded samples; subtracting energy prefixes would lose them. */
export function createMotionAmplitudeNativeCache(provider: MotionAudioSampleProvider, maximumBytes = 2 * 1024 * 1024): MotionAmplitudeNativeCache {
	motionInteger(maximumBytes, 'native amplitude cache bytes', 128 * 1024, 16 * 1024 * 1024);
	const entries = new Map<string, EnergyBlock>(); let bytes = 0;
	return { get bytes() { return bytes; }, get size() { return entries.size; }, clear() { entries.clear(); bytes = 0; },
		async read(asset, format, first, signal, work) {
			signal.throwIfAborted(); const count = Math.min(MOTION_AUDIO_WINDOW_SAMPLES, format.sampleCount - first);
			if (!Number.isSafeInteger(first) || first < 0 || first % MOTION_AUDIO_WINDOW_SAMPLES !== 0 || count <= 0) throw new RangeError('Native amplitude block is outside its retained sample grid.');
			const key = `${asset.sha256}/${format.sampleRate}/${format.channels}/${first}/${count}`; const existing = entries.get(key);
			if (existing) { entries.delete(key); entries.set(key, existing); return existing; }
			work.consume(count);
			const pcm = await provider.read({ asset, startSample: first, sampleCount: count }, signal); signal.throwIfAborted(); validateMotionAudioWindow(pcm, count, format);
			let capacity = 1; while (capacity < count) capacity *= 2; const tree = new Float64Array(capacity * 2);
			for (let index = 0; index < count; index++) {
				let square = 0; for (let channel = 0; channel < format.channels; channel++) { const value = pcm[index * format.channels + channel]!; square += value * value; }
				tree[capacity + index] = square / format.channels;
			}
			for (let index = capacity - 1; index > 0; index--) tree[index] = tree[index * 2]! + tree[index * 2 + 1]!;
			const block = energyBlock(tree, capacity, first, count, tree.byteLength + 256 + key.length * 2);
			while (bytes + block.bytes > maximumBytes) { const oldest = entries.keys().next().value!; bytes -= entries.get(oldest)!.bytes; entries.delete(oldest); }
			entries.set(key, block); bytes += block.bytes; return block;
		},
	};
}

/** This closure retains only the energy tree, never provider-owned interleaved PCM or decode capabilities. */
function energyBlock(tree: Float64Array, capacity: number, first: number, count: number, bytes: number): EnergyBlock {
	return Object.freeze({ first, count, bytes, sum(from: number, end: number): number {
		if (!Number.isSafeInteger(from) || !Number.isSafeInteger(end) || from < 0 || end < from || end > count) throw new RangeError('Amplitude energy interval exceeds its native block.');
		let left = from + capacity, right = end + capacity, value = 0;
		while (left < right) { if (left % 2) value += tree[left++]!; if (right % 2) value += tree[--right]!; left = Math.floor(left / 2); right = Math.floor(right / 2); }
		return value;
	} });
}
