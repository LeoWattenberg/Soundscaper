/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateGeometry } from '../dynamics/core.ts';
import { normalizeStandardDelayParams, standardDelayCapacityFrames } from './delay-definition.ts';

interface Options {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

/** Finite feed-forward taps; paired moving read heads shift pitch causally. */
export function createStandardDelayProcessor({ sampleRate, channelCount, params = {} }: Options) {
	validateGeometry(sampleRate, channelCount);
	let current: Readonly<Record<string, unknown>> = {};
	let rings: Float32Array[] = [];
	let length = 0;
	let writeIndex = 0;
	let offsets = new Float64Array();
	let gains = new Float64Array();
	let phases = new Float64Array();
	let increments = new Float64Array();
	let window = 0;
	let pitched = false;
	let wet = 1;
	function configure(changes: Readonly<Record<string, unknown>>) {
		const next = normalizeStandardDelayParams({ ...current, ...changes });
		const nextLength = standardDelayCapacityFrames(next, sampleRate, channelCount);
		if (nextLength > length) {
			const replacement = Array.from({ length: channelCount }, () => new Float32Array(nextLength));
			if (length > 0) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					replacement[channel].set(rings[channel].subarray(writeIndex), nextLength - length);
					replacement[channel].set(rings[channel].subarray(0, writeIndex), nextLength - writeIndex);
				}
			}
			rings = replacement;
			length = nextLength;
			writeIndex = 0;
		}
		const count = Number(next.echoes);
		if (count !== phases.length) {
			const nextPhases = new Float64Array(count);
			nextPhases.set(phases.subarray(0, count));
			phases = nextPhases;
			offsets = new Float64Array(count);
			gains = new Float64Array(count);
			increments = new Float64Array(count);
		}
		window = Math.max(2, Math.round((next.pitchQuality === 'fast' ? .02 : .08) * sampleRate));
		pitched = Number(next.pitchShift) !== 0;
		let delay = 0;
		for (let echo = 0; echo < count; echo += 1) {
			const interval = next.delayType === 'regular' ? 1
				: next.delayType === 'bouncing-ball' ? (count - echo) / count : (echo + 1) / count;
			delay += Number(next.time) * sampleRate * interval;
			offsets[echo] = Math.max(0, Math.round(delay));
			gains[echo] = 10 ** (Number(next.echoGain) * (echo + 1) / 20);
			increments[echo] = (1 - 2 ** (Number(next.pitchShift) * (echo + 1) / 12)) / window;
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
	function reset() { for (const ring of rings) ring.fill(0); phases.fill(0); writeIndex = 0; }
	configure(params);
	return {
		reset,
		updateParams: configure,
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					const sample = input[channel]?.[frame] ?? 0;
					const dry = Number.isFinite(sample) ? sample : 0;
					const ring = rings[channel];
					ring[writeIndex] = dry;
					let echoes = 0;
					for (let echo = 0; echo < offsets.length; echo += 1) {
						let delayed;
						if (!pitched) delayed = read(ring, offsets[echo]);
						else {
							const first = phases[echo];
							const second = (first + .5) % 1;
							const weight = 1 - Math.abs(2 * first - 1);
							delayed = weight * read(ring, offsets[echo] + first * window)
								+ (1 - weight) * read(ring, offsets[echo] + second * window);
						}
						echoes += delayed * gains[echo];
					}
					if (output[channel]) output[channel][frame] = dry + wet * echoes;
				}
				for (let echo = 0; echo < phases.length; echo += 1) {
					phases[echo] = ((phases[echo] + increments[echo]) % 1 + 1) % 1;
				}
				writeIndex = (writeIndex + 1) % length;
			}
		},
	};
}
