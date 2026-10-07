/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from './audio-clip-loop.ts';
import { exportError, nonNegativeFrame, positiveFrame } from './aup4-export-values.js';

export interface Aup4LoopMaterial {
	readonly periodFrames: number;
	readonly offsetFrames: number;
	readonly durationFrames: number;
}

/** Audacity needs repeated samples; its native stretch ratio describes one pass. */
export function aup4ClipLoopMaterial(clip: { readonly durationFrames?: unknown }): Aup4LoopMaterial | null {
	const loop = readClipLoop(clip);
	return loop ? { ...loop, durationFrames: positiveFrame(clip.durationFrames, 'Audacity-project loop duration') } : null;
}

export function normalizeAup4LoopMaterial(value: unknown): Aup4LoopMaterial | null {
	if (value == null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) throw exportError('Audacity-project loop material is invalid.', 'INVALID_SNAPSHOT');
	const fields = value as Record<string, unknown>;
	const periodFrames = positiveFrame(fields.periodFrames, 'Audacity-project loop period');
	const offsetFrames = nonNegativeFrame(fields.offsetFrames, 'Audacity-project loop offset');
	const durationFrames = positiveFrame(fields.durationFrames, 'Audacity-project loop duration');
	if (offsetFrames >= periodFrames) throw exportError('Audacity-project loop offset is invalid.', 'INVALID_SNAPSHOT');
	return { periodFrames, offsetFrames, durationFrames };
}

/** Round boundaries in the native sample clock without unsafe frame multiplication. */
function scaledLoopFrames(frames: number, loop: Aup4LoopMaterial, nativePeriodFrames: number): number {
	const period = BigInt(loop.periodFrames);
	const result = (BigInt(frames) * BigInt(nativePeriodFrames) + period / 2n) / period;
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw exportError('Audacity-project loop material exceeds the safe frame range.', 'INVALID_SNAPSHOT');
	return Number(result);
}

export function aup4LoopMaterialFrameCount(loop: Aup4LoopMaterial, nativePeriodFrames: number): number {
	return Math.max(1, scaledLoopFrames(loop.durationFrames, loop, nativePeriodFrames));
}

/** Reverse, gain and sample-speed conversion have already been applied to one period. */
export function materializeAup4Loop(channels: readonly Float32Array[], loop: Aup4LoopMaterial | null): Float32Array[] {
	if (!loop) return [...channels];
	const nativePeriodFrames = channels[0]?.length ?? 0;
	if (!nativePeriodFrames || channels.some((channel) => channel.length !== nativePeriodFrames)) throw exportError('Audacity-project loop period has invalid channels.', 'INVALID_SOURCE_AUDIO');
	const frameCount = aup4LoopMaterialFrameCount(loop, nativePeriodFrames);
	const offset = scaledLoopFrames(loop.offsetFrames, loop, nativePeriodFrames) % nativePeriodFrames;
	return channels.map((period) => {
		const output = new Float32Array(frameCount);
		for (let frame = 0; frame < frameCount;) {
			const start = (offset + frame) % nativePeriodFrames;
			const count = Math.min(nativePeriodFrames - start, frameCount - frame);
			output.set(period.subarray(start, start + count), frame);
			frame += count;
		}
		return output;
	});
}
