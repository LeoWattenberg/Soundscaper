/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateGeometry } from '../dynamics/core.ts';
import { normalizeStandardDelayParams, standardDelayCapacityFrames, standardDelayLatencyFrames, standardDelayPitchStageLatencyFrames } from './delay-definition.ts';
import { createDelayPitchStream } from './delay-pitch-stream.ts';
import type { StaffPadWasmRuntime } from '../../staffpad/runtime.js';

interface Options {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly staffPadRuntime?: StaffPadWasmRuntime;
}

/** Finite feed-forward taps. Pitched echoes use the editor's StaffPad engine. */
export function createStandardDelayProcessor({ sampleRate, channelCount, params = {}, staffPadRuntime }: Options) {
	validateGeometry(sampleRate, channelCount);
	let current: Readonly<Record<string, unknown>> = {};
	let rings: Float32Array[] = [];
	let length = 0;
	let writeIndex = 0;
	let offsets = new Float64Array();
	let gains = new Float64Array();
	let pitchStreams: ReturnType<typeof createDelayPitchStream>[] = [];
	const samples = new Float64Array(channelCount);
	let latency = 0;
	let stageLatency = 0;
	let pitched = false;
	let wet = 1;
	function configure(changes: Readonly<Record<string, unknown>>) {
		const next = normalizeStandardDelayParams({ ...current, ...changes });
		const nextLength = standardDelayCapacityFrames(next, sampleRate, channelCount);
		const nextPitched = Number(next.pitchShift) !== 0 && Number(next.mix) !== 0;
		if (nextPitched && !staffPadRuntime) throw new Error('StaffPad must be loaded before pitched delay can run.');
		const count = Number(next.echoes);
		const pitchChanged = nextPitched !== pitched || next.pitchShift !== current.pitchShift || count !== offsets.length;
		if (pitchChanged) {
			const replacement: typeof pitchStreams = [];
			try {
				if (nextPitched && staffPadRuntime) for (let echo = 0; echo < count; echo++) replacement.push(createDelayPitchStream(staffPadRuntime, sampleRate, channelCount, Number(next.pitchShift)));
			} catch (error) {
				for (const stream of replacement) stream.dispose();
				throw error;
			}
			for (const stream of pitchStreams) stream.dispose();
			pitchStreams = replacement;
		}
		const nextRingCount = nextPitched ? (count + 1) * channelCount : channelCount;
		if (nextLength > length || rings.length !== nextRingCount) {
			const replacement = Array.from({ length: nextRingCount }, () => new Float32Array(nextLength));
			if (length > 0 && rings.length === nextRingCount && nextLength >= length) {
				for (let channel = 0; channel < nextRingCount; channel += 1) {
					replacement[channel].set(rings[channel].subarray(writeIndex), nextLength - length);
					replacement[channel].set(rings[channel].subarray(0, writeIndex), nextLength - writeIndex);
				}
			}
			rings = replacement;
			length = nextLength;
			writeIndex = 0;
		}
		if (count !== offsets.length) {
			offsets = new Float64Array(count);
			gains = new Float64Array(count);
		}
		pitched = nextPitched;
		latency = standardDelayLatencyFrames(next, sampleRate);
		stageLatency = standardDelayPitchStageLatencyFrames(next, sampleRate);
		let delay = 0;
		for (let echo = 0; echo < count; echo += 1) {
			const interval = next.delayType === 'regular' ? 1
				: next.delayType === 'bouncing-ball' ? (count - echo) / count : (echo + 1) / count;
			delay += Number(next.time) * sampleRate * interval;
			offsets[echo] = Math.max(0, Math.round(delay));
			gains[echo] = 10 ** (Number(next.echoGain) * (echo + 1) / 20);
		}
		wet = Number(next.mix);
		current = next;
	}
	function read(ring: Float32Array, delay: number): number {
		const position = (writeIndex - delay + length) % length;
		const index = Math.floor(position);
		const fraction = position - index;
		return ring[index] + fraction * (ring[(index + 1) % length] - ring[index]);
	}
	function reset() { for (const ring of rings) ring.fill(0); for (const stream of pitchStreams) stream.reset(); writeIndex = 0; }
	configure(params);
	return {
		reset,
		get latencyFrames(): number { return latency; },
		dispose(): void { for (const stream of pitchStreams) stream.dispose(); pitchStreams = []; },
		updateParams: configure,
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				for (let channel = 0; channel < channelCount; channel++) {
					const value = input[channel]?.[frame] ?? 0;
					samples[channel] = Number.isFinite(value) ? value : 0;
					rings[channel][writeIndex] = samples[channel];
				}
				for (let echo = 0; echo < pitchStreams.length; echo++) {
					pitchStreams[echo].processFrame(samples);
					for (let channel = 0; channel < channelCount; channel++) rings[(echo + 1) * channelCount + channel][writeIndex] = samples[channel];
				}
				for (let channel = 0; channel < channelCount; channel++) {
					let echoes = 0;
					for (let echo = 0; echo < offsets.length; echo++) {
						const ring = rings[pitched ? (echo + 1) * channelCount + channel : channel];
						const compensation = pitched ? latency - stageLatency * (echo + 1) : 0;
						echoes += read(ring, offsets[echo] + compensation) * gains[echo];
					}
					if (output[channel]) output[channel][frame] = read(rings[channel], latency) + wet * echoes;
				}
				writeIndex = (writeIndex + 1) % length;
			}
		},
	};
}
