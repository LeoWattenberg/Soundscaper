/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWindowedSincChannelSampler } from './windowed-sinc-kernel.ts';
import type { MotionAudioWindow } from './motion-audio-window-cache.ts';

/** Pitched rate conversion with anti-alias filtering; bounded to a 32:1 source/output rate. */
export function createMotionAudioSampler() {
	const samplers = new Map<string, ReturnType<typeof createWindowedSincChannelSampler>>();
	const output = [new Float32Array(1), new Float32Array(1)];
	return (window: MotionAudioWindow, position: number, ratio: number): readonly [number, number] => {
		if (!Number.isFinite(ratio) || ratio < 0 || ratio > 32) throw new RangeError('Motion audio source/output rate exceeds the supported 32:1 resampling budget.');
		const nearest = Math.round(position);
		if (ratio <= 1 && Math.abs(position - nearest) < 1e-9) {
			const index = nearest - window.startSample;
			return [window.channels[0]![index] ?? 0, window.channels[1]?.[index] ?? window.channels[0]![index] ?? 0];
		}
		const radius = 32 * Math.max(1, Math.ceil(ratio)); const cutoff = 1 / Math.max(1, ratio); const key = `${radius}:${cutoff}`;
		let sampler = samplers.get(key);
		if (!sampler) { sampler = createWindowedSincChannelSampler(radius, cutoff); samplers.set(key, sampler); }
		else { samplers.delete(key); samplers.set(key, sampler); }
		if (samplers.size > 16) samplers.delete(samplers.keys().next().value!);
		sampler(window.channels, window.startSample, window.endSample, position, output, 0);
		return [output[0]![0]!, window.channels.length === 1 ? output[0]![0]! : output[1]![0]!];
	};
}
