/* SPDX-License-Identifier: AGPL-3.0-only */

import { ComplementaryCrossover, validateGeometry } from '../dynamics/core.ts';
import { noiseGateLatencyFrames, normalizeNoiseGateParams } from './noise-gate-definition.ts';

interface Options {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

const ATTACK_NORMALIZATION = -Math.expm1(-1);

/** Previewed peak gate with a complementary split for frequency-selective gating. */
export function createNoiseGateProcessor(options: Options) {
	return createNoiseGateState(options, false);
}

/** Fixed selection jobs can share linked gains and omit unused crossover history. */
export function createOfflineNoiseGateProcessor(options: Options) {
	return createNoiseGateState(options, true);
}

function createNoiseGateState({ sampleRate, channelCount, params = {} }: Options, fixed: boolean) {
	validateGeometry(sampleRate, channelCount);
	let current: Readonly<Record<string, unknown>> = {};
	let configured: Record<string, number | string> | null = null;
	let threshold = 0;
	let floor = 0;
	let attackFrames = 0;
	let release = 0;
	let hold = 0;
	let linked = true;
	let frequency = 0;
	let latencyFrames = 0;
	let cursor = 0;
	let history: Float32Array[] = [];
	const gains = new Float64Array(channelCount);
	const held = new Float64Array(channelCount);
	const opening = new Float64Array(channelCount);
	const openingGain = new Float64Array(channelCount);
	let crossovers: ComplementaryCrossover[] = [];
	function joinEnvelopes() {
		let loudest = 0;
		for (let channel = 1; channel < channelCount; channel += 1) {
			if (gains[channel] > gains[loudest]) loudest = channel;
		}
		gains.fill(gains[loudest]);
		opening.fill(opening[loudest]);
		openingGain.fill(openingGain[loudest]);
		held.fill(Math.max(...held));
	}
	function configure(changes: Readonly<Record<string, unknown>>) {
		const merged = { ...current, ...changes };
		const next = normalizeNoiseGateParams(merged);
		const nextFrequency = Number(next.gateFrequency);
		if (nextFrequency >= sampleRate / 2) throw new RangeError('noise-gate.gateFrequency must be below Nyquist.');
		current = merged;
		if (configured && Object.keys(next).every(key => Object.is(next[key], configured![key]))) return;
		configured = next;
		if (crossovers.length === 0 && (!fixed || nextFrequency > 0)) {
			crossovers = Array.from({ length: 2 }, () => new ComplementaryCrossover(sampleRate, channelCount, 1000));
		}
		const nextLatencyFrames = noiseGateLatencyFrames(next, sampleRate);
		const nextHistory = nextLatencyFrames !== latencyFrames
			? Array.from({ length: channelCount }, () => new Float32Array(nextLatencyFrames)) : history;
		threshold = 10 ** (Number(next.threshold) / 20);
		floor = Number(next.rangeDb) <= -96 ? 0 : 10 ** (Number(next.rangeDb) / 20);
		attackFrames = Math.ceil(Number(next.attack) * sampleRate);
		release = Math.exp(-1 / (Number(next.release) * sampleRate));
		hold = Math.round(Number(next.hold) * sampleRate);
		if (!linked && next.stereoLink === 'linked') joinEnvelopes();
		linked = next.stereoLink === 'linked';
		if (nextFrequency > 0) for (const crossover of crossovers) crossover.configure(nextFrequency);
		frequency = nextFrequency;
		if (nextLatencyFrames !== latencyFrames) {
			latencyFrames = nextLatencyFrames;
			history = nextHistory;
			reset();
		}
	}
	function reset() {
		gains.fill(floor);
		held.fill(0);
		opening.fill(0);
		cursor = 0;
		for (const channel of history) channel.fill(0);
		for (const crossover of crossovers) crossover.reset();
	}
	configure(params);
	reset();
	return {
		reset,
		updateParams: fixed ? () => { throw new Error('Offline noise-gate parameters are fixed.'); } : configure,
		get latencyFrames() { return latencyFrames; },
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				let peak = 0;
				if (linked) for (const channel of input) {
					const sample = channel[frame];
					if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
				}
				if (!fixed || frequency > 0) for (const crossover of crossovers) crossover.tick();
				for (let channel = 0; channel < channelCount; channel += 1) {
					const sample = input[channel]?.[frame] ?? 0;
					const sanitized = Number.isFinite(sample) ? sample : 0;
					const dry = latencyFrames > 0 ? history[channel][cursor] : sanitized;
					if (latencyFrames > 0) history[channel][cursor] = sanitized;
					const detector = linked ? peak : Math.abs(sanitized);
					if (!fixed || !linked || channel === 0) {
						// Keep hold relative to delayed audio, rather than ending it early by the preview window.
						if (detector >= threshold) held[channel] = hold + latencyFrames;
						const target = detector >= threshold || held[channel] > 0 ? 1 : floor;
						if (detector < threshold && held[channel] > 0) held[channel] -= 1;
						if (target > gains[channel]) {
							if (opening[channel] === 0) openingGain[channel] = gains[channel];
							opening[channel] += 1;
							const progress = Math.min(1, opening[channel] / attackFrames);
							// Finish the exponential attack on time, so full preview preserves the first transient.
							gains[channel] = progress === 1 ? target
								: openingGain[channel] + (target - openingGain[channel]) * -Math.expm1(-progress) / ATTACK_NORMALIZATION;
						} else {
							opening[channel] = 0;
							gains[channel] = target + release * (gains[channel] - target);
						}
					}
					const gain = fixed && linked ? gains[0] : gains[channel];
					let low = dry;
					if (!fixed || frequency > 0) for (const crossover of crossovers) low = crossover.low(low, channel);
					if (output[channel]) output[channel][frame] = floor === 1 || gain === 1 ? dry
						: frequency > 0 ? dry + (dry - low) * (gain - 1) : dry * gain;
				}
				if (latencyFrames > 0) cursor = (cursor + 1) % latencyFrames;
			}
		},
	};
}
