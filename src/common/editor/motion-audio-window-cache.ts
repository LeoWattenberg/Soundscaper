/* SPDX-License-Identifier: AGPL-3.0-only */

import { MOTION_AUDIO_WINDOW_SAMPLES, normalizeMotionAudioFormat, validateMotionAudioWindow, type MotionAudioAsset, type MotionAudioFormat, type MotionAudioSampleProvider } from './motion-audio-contract.ts';

export interface MotionAudioWindow { readonly channels: readonly Float32Array[]; readonly startSample: number; readonly endSample: number; readonly byteLength: number }
/** One caller/read at a time. Copies provider-owned samples before admitting them to the bounded LRU. */
export function createMotionAudioWindowCache(provider: MotionAudioSampleProvider, maximumBytes: number) {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 32768 || maximumBytes > 256 * 1024 * 1024) throw new RangeError('Motion PCM cache must be between 32 KiB and 256 MiB.');
	const formats = new Map<string, MotionAudioFormat>(); const windows = new Map<string, MotionAudioWindow>(); let byteLength = 0;
	return {
		get byteLength() { return byteLength; }, get size() { return windows.size; },
		clear() { windows.clear(); formats.clear(); byteLength = 0; },
		async describe(asset: MotionAudioAsset, signal: AbortSignal): Promise<MotionAudioFormat> {
			signal.throwIfAborted(); const previous = formats.get(asset.sha256);
			const format = previous ?? normalizeMotionAudioFormat(await provider.describe(asset, signal)); signal.throwIfAborted();
			if (asset.kind === 'audio' && (asset.sampleRate !== format.sampleRate || asset.channels !== format.channels)) throw new Error('Motion PCM description differs from retained audio metadata.');
			formats.set(asset.sha256, format); return format;
		},
		async read(asset: MotionAudioAsset, format: MotionAudioFormat, position: number, signal: AbortSignal): Promise<MotionAudioWindow> {
			signal.throwIfAborted();
			const core = Math.floor(position / 2048) * 2048;
			const startSample = Math.max(0, core - 1024); const endSample = Math.min(format.sampleCount, core + 3072);
			const count = endSample - startSample;
			if (!Number.isSafeInteger(count) || count < 1 || count > MOTION_AUDIO_WINDOW_SAMPLES) throw new RangeError('Motion PCM window exceeds its native read budget.');
			const key = `${asset.sha256}:${startSample}:${count}`; const previous = windows.get(key);
			if (previous) { windows.delete(key); windows.set(key, previous); return previous; }
			const interleaved = await provider.read({ asset, startSample, sampleCount: count }, signal); signal.throwIfAborted(); validateMotionAudioWindow(interleaved, count, format);
			const channels = Array.from({ length: format.channels }, (_, channel) => Float32Array.from({ length: count }, (_, index) => interleaved[index * format.channels + channel]!));
			const window = { channels, startSample, endSample, byteLength: count * format.channels * 4 };
			while (byteLength + window.byteLength > maximumBytes) {
				const oldest = windows.entries().next().value; if (!oldest) break;
				windows.delete(oldest[0]); byteLength -= oldest[1].byteLength;
			}
			windows.set(key, window); byteLength += window.byteLength; return window;
		},
	};
}
