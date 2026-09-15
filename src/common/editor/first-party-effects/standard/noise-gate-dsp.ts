/* SPDX-License-Identifier: AGPL-3.0-only */

import { ComplementaryCrossover, validateGeometry } from '../dynamics/core.ts';
import { normalizeNoiseGateParams } from './noise-gate-definition.ts';

interface Options {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

/** Causal peak gate with a complementary split for frequency-selective gating. */
export function createNoiseGateProcessor({ sampleRate, channelCount, params = {} }: Options) {
	validateGeometry(sampleRate, channelCount);
	let current: Readonly<Record<string, unknown>> = {};
	let threshold = 0;
	let floor = 0;
	let attack = 0;
	let release = 0;
	let hold = 0;
	let linked = true;
	let frequency = 0;
	const gains = new Float64Array(channelCount);
	const held = new Float64Array(channelCount);
	const crossovers = Array.from({ length: 2 }, () => new ComplementaryCrossover(sampleRate, channelCount, 1000));
	function configure(changes: Readonly<Record<string, unknown>>) {
		const next = normalizeNoiseGateParams({ ...current, ...changes });
		const nextFrequency = Number(next.gateFrequency);
		if (nextFrequency >= sampleRate / 2) throw new RangeError('noise-gate.gateFrequency must be below Nyquist.');
		threshold = 10 ** (Number(next.threshold) / 20);
		floor = Number(next.rangeDb) <= -96 ? 0 : 10 ** (Number(next.rangeDb) / 20);
		attack = Math.exp(-1 / (Number(next.attack) * sampleRate));
		release = Math.exp(-1 / (Number(next.release) * sampleRate));
		hold = Math.round(Number(next.hold) * sampleRate);
		linked = next.stereoLink === 'linked';
		if (nextFrequency > 0) for (const crossover of crossovers) crossover.configure(nextFrequency);
		frequency = nextFrequency;
		current = next;
	}
	function reset() { gains.fill(floor); held.fill(0); for (const crossover of crossovers) crossover.reset(); }
	configure(params);
	reset();
	return {
		reset,
		updateParams: configure,
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				let peak = 0;
				if (linked) for (const channel of input) {
					const sample = channel[frame];
					if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
				}
				for (const crossover of crossovers) crossover.tick();
				for (let channel = 0; channel < channelCount; channel += 1) {
					const sample = input[channel]?.[frame] ?? 0;
					const dry = Number.isFinite(sample) ? sample : 0;
					const detector = linked ? peak : Math.abs(dry);
					if (detector >= threshold) held[channel] = hold;
					const target = detector >= threshold || held[channel] > 0 ? 1 : floor;
					if (detector < threshold && held[channel] > 0) held[channel] -= 1;
					const coefficient = target > gains[channel] ? attack : release;
					gains[channel] = target + coefficient * (gains[channel] - target);
					let low = dry;
					for (const crossover of crossovers) low = crossover.low(low, channel);
					if (output[channel]) output[channel][frame] = floor === 1 || gains[channel] === 1 ? dry
						: frequency > 0 ? dry + (dry - low) * (gains[channel] - 1) : dry * gains[channel];
				}
			}
		},
	};
}
