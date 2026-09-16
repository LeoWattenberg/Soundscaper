/*
 * Persistent browser-native Schroeder/Freeverb-style reverb. The same core
 * serves selection rendering and realtime inserts, without a SoX dependency.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import {
	REVERB_ALLPASS_DELAYS_44K,
	REVERB_COMB_DELAYS_44K,
	audacityBrowserReverbTailFrames,
	normalizeReverbParams,
	reverbAllpassDelayFrames,
	reverbCombDelayFrames,
	reverbToneCornerHz,
	validateReverbSampleRate,
	type ReverbParams,
} from './reverb-parameters.ts';

interface DelayState {
	buffer: Float32Array;
	position: number;
}
interface CombState extends DelayState {
	filter: number;
}
interface ToneState {
	input: number;
	output: number;
}
interface ToneCoefficients {
	b0: number;
	b1: number;
	a1: number;
}
interface ReverbChannel {
	combs: CombState[];
	allpasses: DelayState[];
	preDelay: DelayState | null;
	highpass: ToneState;
	lowpass: ToneState;
}

/** Implements the LiveProcessor lifecycle without pulling live capabilities into the selection graph. */
export class ReverbLiveProcessor {
	readonly type = 'audacity-reverb';
	readonly sampleRate: number;
	readonly latencyFrames = 0;
	params: ReverbParams;
	tailFrames = 0;
	private readonly states: ReverbChannel[] = [];
	private readonly sources: (Float32Array | null)[] = [];
	private readonly inputCopies: (Float32Array | undefined)[] = [];
	private readonly dryValues: number[] = [];
	private readonly wetValues: number[] = [];
	private preDelayFrames = 0;
	private feedback = 0;
	private damping = 0;
	private wetGain = 0;
	private dryGain = 0;
	private directWet = 0;
	private crossWet = 0;
	private highpass: ToneCoefficients = { b0: 0, b1: 0, a1: 0 };
	private lowpass: ToneCoefficients = { b0: 0, b1: 0, a1: 0 };

	constructor(sampleRate: number, params: Partial<ReverbParams> = {}) {
		validateReverbSampleRate(sampleRate);
		this.sampleRate = sampleRate;
		this.params = normalizeReverbParams(params);
		this.configure();
	}

	updateParams(params: Partial<ReverbParams> = {}): void {
		const normalized = normalizeReverbParams({ ...this.params, ...params });
		const rebuild = normalized.roomSize !== this.params.roomSize
			|| normalized.preDelay !== this.params.preDelay
			|| normalized.stereoWidth !== this.params.stereoWidth;
		this.params = normalized;
		this.configure();
		if (rebuild) this.reset();
	}

	configure(): void {
		const settings = this.params;
		this.preDelayFrames = Math.round(settings.preDelay / 1_000 * this.sampleRate);
		this.feedback = (0.28 + settings.roomSize / 100 * 0.7) * (0.2 + settings.reverberance / 100 * 0.78);
		this.damping = Math.min(0.98, settings.damping / 100);
		this.wetGain = 10 ** (settings.wetGainDb / 20) * settings.reverberance / 100;
		this.dryGain = settings.wetOnly ? 0 : 10 ** (settings.dryGainDb / 20);
		this.directWet = 0.5 + settings.stereoWidth / 100 * 0.5;
		this.crossWet = 0.5 - settings.stereoWidth / 100 * 0.5;
		const highpassA1 = -Math.exp(-2 * Math.PI * reverbToneCornerHz(-settings.toneLow) / this.sampleRate);
		const highpassB0 = (1 - highpassA1) / 2;
		this.highpass = { b0: highpassB0, b1: -highpassB0, a1: highpassA1 };
		const lowpassA1 = -Math.exp(-2 * Math.PI * reverbToneCornerHz(settings.toneHigh) / this.sampleRate);
		this.lowpass = { b0: 1 + lowpassA1, b1: 0, a1: lowpassA1 };
		this.tailFrames = audacityBrowserReverbTailFrames(this.sampleRate, settings);
	}

	reset(): void {
		for (const state of this.states) {
			for (const comb of state.combs) {
				clearDelay(comb);
				comb.filter = 0;
			}
			for (const allpass of state.allpasses) clearDelay(allpass);
			if ((state.preDelay?.buffer.length ?? 0) !== this.preDelayFrames) {
				state.preDelay = this.preDelayFrames > 0 ? createDelay(this.preDelayFrames) : null;
			}
			if (state.preDelay) clearDelay(state.preDelay);
			state.highpass.input = 0;
			state.highpass.output = 0;
			state.lowpass.input = 0;
			state.lowpass.output = 0;
		}
		this.sources.fill(null);
		this.dryValues.fill(0);
		this.wetValues.fill(0);
	}

	readAnalysis(): null { return null; }

	setNoiseProfile(): never {
		throw new RangeError('audacity-reverb does not use a noise profile.');
	}

	process(input: readonly Float32Array[], output: readonly Float32Array[]): true {
		const frames = validateBlock(input, output);
		this.ensureChannels(output.length);
		// The normal in-place case needs only per-frame scalar scratch. A shifted
		// output view can overwrite future input, so copy only those sources into
		// reusable block storage before writing any output channel.
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = input.length > 0 ? input[Math.min(channel, input.length - 1)] ?? null : null;
			if (source && hasForwardOverlap(source, output)) {
				let copy = this.inputCopies[channel];
				if (!copy || copy.length < frames) {
					copy = new Float32Array(frames);
					this.inputCopies[channel] = copy;
				}
				copy.set(source);
				this.sources[channel] = copy;
			} else this.sources[channel] = source;
		}
		for (let frame = 0; frame < frames; frame += 1) {
			// ensureChannels creates every state; fill all scratch slots before
			// reading another channel's wet value or writing aliased output.
			for (let channel = 0; channel < output.length; channel += 1) {
				this.dryValues[channel] = this.sources[channel]?.[frame] ?? 0;
			}
			for (let channel = 0; channel < output.length; channel += 1) {
				// The selection implementation stored its processed wet sample in
				// Float32 before stereo mixing; retain that exact rounding boundary.
				this.wetValues[channel] = Math.fround(this.processWet(this.states[channel]!, this.dryValues[channel]!));
			}
			for (let channel = 0; channel < output.length; channel += 1) {
				const opposite = this.wetValues[(channel + 1) % output.length]!;
				output[channel]![frame] = this.dryValues[channel]! * this.dryGain
					+ (this.wetValues[channel]! * this.directWet + opposite * this.crossWet) * this.wetGain;
			}
		}
		return true;
	}

	private ensureChannels(count: number): void {
		while (this.states.length < count) {
			const channel = this.states.length;
			this.states.push({
				combs: REVERB_COMB_DELAYS_44K.map((_, index) => ({
					...createDelay(reverbCombDelayFrames(index, channel, this.sampleRate)), filter: 0,
				})),
				allpasses: REVERB_ALLPASS_DELAYS_44K.map((_, index) => createDelay(reverbAllpassDelayFrames(index, channel, this.sampleRate))),
				preDelay: this.preDelayFrames > 0 ? createDelay(this.preDelayFrames) : null,
				highpass: { input: 0, output: 0 }, lowpass: { input: 0, output: 0 },
			});
		}
		this.states.length = count;
		this.sources.length = count;
		this.inputCopies.length = count;
		this.dryValues.length = count;
		this.wetValues.length = count;
	}

	private processWet(state: ReverbChannel, dry: number): number {
		// Every delay has at least one frame, and modulo advances keep its
		// position inside that buffer for the indexed reads below.
		let source = dry;
		if (state.preDelay) {
			source = state.preDelay.buffer[state.preDelay.position]!;
			state.preDelay.buffer[state.preDelay.position] = dry;
			state.preDelay.position = (state.preDelay.position + 1) % state.preDelay.buffer.length;
		}
		let value = 0;
		for (const comb of state.combs) {
			const delayed = comb.buffer[comb.position]!;
			comb.filter = delayed * (1 - this.damping) + comb.filter * this.damping;
			comb.buffer[comb.position] = source + comb.filter * this.feedback;
			comb.position = (comb.position + 1) % comb.buffer.length;
			value += delayed;
		}
		value /= state.combs.length;
		for (const allpass of state.allpasses) {
			const delayed = allpass.buffer[allpass.position]!;
			const result = delayed - value;
			allpass.buffer[allpass.position] = value + delayed * 0.5;
			allpass.position = (allpass.position + 1) % allpass.buffer.length;
			value = result;
		}
		return processTone(state.lowpass, processTone(state.highpass, value, this.highpass), this.lowpass);
	}
}

function createDelay(length: number): DelayState {
	return { buffer: new Float32Array(length), position: 0 };
}

function clearDelay(state: DelayState): void {
	state.buffer.fill(0);
	state.position = 0;
}

function processTone(state: ToneState, input: number, coefficients: ToneCoefficients): number {
	const output = input * coefficients.b0 + state.input * coefficients.b1 - state.output * coefficients.a1;
	state.input = input;
	state.output = output;
	return output;
}

function hasForwardOverlap(source: Float32Array, output: readonly Float32Array[]): boolean {
	for (const destination of output) {
		if (destination.buffer === source.buffer && destination.byteOffset > source.byteOffset
			&& destination.byteOffset < source.byteOffset + source.byteLength) return true;
	}
	return false;
}

function validateBlock(input: readonly Float32Array[], output: readonly Float32Array[]): number {
	if (!Array.isArray(input) || !Array.isArray(output) || output.length === 0) throw new TypeError('Input and output channel arrays are required.');
	const frames = output[0].length;
	for (const channel of output) {
		if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Output channels must be equal-length Float32Array values.');
	}
	for (const channel of input) {
		if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Input channels must match the output block length.');
	}
	return frames;
}
