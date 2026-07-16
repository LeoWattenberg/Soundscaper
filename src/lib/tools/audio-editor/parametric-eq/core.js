import { designParametricEq } from './design.js';

const DEFAULT_PARAMETER_SMOOTHING_SECONDS = 0.005;
const DEFAULT_BYPASS_CROSSFADE_SECONDS = 0.01;
const DEFAULT_STRUCTURE_CROSSFADE_SECONDS = 0.02;
const STATE_FLUSH_THRESHOLD = 1e-30;
const MAX_CHANNELS = 32;

export class ParametricEqProcessor {
	constructor(sampleRate, params = {}, options = {}) {
		this.sampleRate = normalizeSampleRate(sampleRate);
		this.effectId = options.effectId;
		this.smoothingFrames = normalizeFrames(
			options.smoothingFrames,
			Math.round(this.sampleRate * DEFAULT_PARAMETER_SMOOTHING_SECONDS),
		);
		this.crossfadeFrames = normalizeFrames(
			options.crossfadeFrames,
			Math.round(this.sampleRate * DEFAULT_STRUCTURE_CROSSFADE_SECONDS),
		);
		this.bypassFrames = normalizeFrames(
			options.bypassFrames,
			Math.round(this.sampleRate * DEFAULT_BYPASS_CROSSFADE_SECONDS),
		);
		this.auditionBandId = options.auditionBandId == null ? null : String(options.auditionBandId);
		this.configuration = designParametricEq(params, this.sampleRate, {
			effectId: this.effectId,
			auditionBandId: this.auditionBandId,
		});
		this.active = new ProcessingChain(this.configuration);
		this.previous = null;
		this.crossfadeFrame = 0;
		this.crossfadeLength = 0;
	}

	configure(params, options = {}) {
		const configuration = designParametricEq(params, this.sampleRate, {
			effectId: this.effectId,
			auditionBandId: this.auditionBandId,
		});
		const requestedFrames = normalizeFrames(options.transitionFrames, null);
		if (configuration.topologyKey === this.configuration.topologyKey) {
			this.active.retarget(
				configuration,
				requestedFrames ?? this.smoothingFrames,
				requestedFrames ?? this.bypassFrames,
			);
			this.configuration = configuration;
			return { topologyChanged: false, transitionFrames: requestedFrames ?? this.smoothingFrames };
		}
		this.#replaceChain(configuration, requestedFrames ?? this.crossfadeFrames);
		return { topologyChanged: true, transitionFrames: requestedFrames ?? this.crossfadeFrames };
	}

	setAudition(bandId, options = {}) {
		const nextBandId = bandId == null ? null : String(bandId);
		if (nextBandId === this.auditionBandId) return false;
		this.auditionBandId = nextBandId;
		const configuration = designParametricEq(this.configuration.packet, this.sampleRate, {
			effectId: this.effectId,
			auditionBandId: this.auditionBandId,
		});
		this.#replaceChain(
			configuration,
			normalizeFrames(options.transitionFrames, this.crossfadeFrames),
		);
		return true;
	}

	process(inputChannels, outputChannels) {
		const input = normalizeInputChannels(inputChannels);
		const frames = input[0]?.length ?? outputChannels?.[0]?.length ?? 0;
		const channelCount = Math.max(input.length, outputChannels?.length || 0);
		if (channelCount > MAX_CHANNELS) throw new RangeError(`Parametric EQ supports at most ${MAX_CHANNELS} channels.`);
		const output = outputChannels || Array.from(
			{ length: channelCount },
			(_, channel) => new Float32Array(input[channel]?.length ?? frames),
		);
		for (let channel = 0; channel < output.length; channel += 1) {
			if (output[channel].length !== frames) throw new RangeError('Parametric EQ output channels must have equal frame lengths.');
		}
		for (let frame = 0; frame < frames; frame += 1) {
			this.active.advanceFrame();
			this.previous?.advanceFrame();
			let mix = 1;
			if (this.previous && this.crossfadeLength > 0) {
				const progress = Math.min(1, (this.crossfadeFrame + 1) / this.crossfadeLength);
				mix = 0.5 - 0.5 * Math.cos(Math.PI * progress);
			}
			for (let channel = 0; channel < output.length; channel += 1) {
				const source = input[Math.min(channel, Math.max(0, input.length - 1))];
				const sample = Number(source?.[frame]) || 0;
				const current = this.active.processSample(sample, channel);
				if (this.previous) {
					const previous = this.previous.processSample(sample, channel);
					output[channel][frame] = previous + (current - previous) * mix;
				} else {
					output[channel][frame] = current;
				}
			}
			if (this.previous) {
				this.crossfadeFrame += 1;
				if (this.crossfadeFrame >= this.crossfadeLength) {
					this.previous = null;
					this.crossfadeFrame = 0;
					this.crossfadeLength = 0;
				}
			}
		}
		this.active.flushSmallStates();
		this.previous?.flushSmallStates();
		return output;
	}

	reset() {
		this.active.reset();
		this.previous = null;
		this.crossfadeFrame = 0;
		this.crossfadeLength = 0;
	}

	#replaceChain(configuration, transitionFrames) {
		const next = new ProcessingChain(configuration);
		this.configuration = configuration;
		if (transitionFrames > 0) {
			this.previous = this.active;
			this.crossfadeFrame = 0;
			this.crossfadeLength = transitionFrames;
		} else {
			this.previous = null;
			this.crossfadeFrame = 0;
			this.crossfadeLength = 0;
		}
		this.active = next;
	}
}

export function processParametricEqChannels(channels, sampleRate, params, options = {}) {
	const input = normalizeInputChannels(channels);
	if (!input.length) return [];
	const frames = input[0].length;
	for (const channel of input) {
		if (channel.length !== frames) throw new RangeError('Parametric EQ input channels must have equal frame lengths.');
	}
	const processor = new ParametricEqProcessor(sampleRate, params, {
		...options,
		smoothingFrames: 0,
		crossfadeFrames: 0,
	});
	return processor.process(input);
}

class ProcessingChain {
	constructor(configuration) {
		this.topologyKey = configuration.topologyKey;
		this.bands = groupSections(configuration.sections).map((sections) => new ProcessingBand(sections));
		this.outputGainDb = configuration.outputGainDb;
		this.outputGainTargetDb = configuration.outputGainDb;
		this.outputGainStep = 0;
		this.outputGainFrames = 0;
	}

	retarget(configuration, transitionFrames, bypassFrames) {
		const grouped = groupSections(configuration.sections);
		if (configuration.topologyKey !== this.topologyKey || grouped.length !== this.bands.length) {
			throw new Error('Cannot retarget a parametric EQ chain with a different topology.');
		}
		for (let index = 0; index < this.bands.length; index += 1) {
			this.bands[index].retarget(grouped[index], transitionFrames, bypassFrames);
		}
		this.outputGainTargetDb = configuration.outputGainDb;
		this.outputGainFrames = transitionFrames;
		this.outputGainStep = transitionFrames > 0
			? (this.outputGainTargetDb - this.outputGainDb) / transitionFrames
			: 0;
		if (transitionFrames === 0) this.outputGainDb = this.outputGainTargetDb;
	}

	processSample(input, channel) {
		let output = input;
		for (const band of this.bands) output = band.processSample(output, channel);
		return output * 10 ** (this.outputGainDb / 20);
	}

	advanceFrame() {
		for (const band of this.bands) band.advanceFrame();
		if (this.outputGainFrames > 0) {
			this.outputGainDb += this.outputGainStep;
			this.outputGainFrames -= 1;
			if (this.outputGainFrames === 0) this.outputGainDb = this.outputGainTargetDb;
		}
	}

	reset() {
		for (const band of this.bands) band.reset();
	}

	flushSmallStates() {
		for (const band of this.bands) band.flushSmallStates();
	}
}

class ProcessingBand {
	constructor(sections) {
		this.id = sections[0]?.bandId || '';
		this.sections = sections.map((section) => new TptSection(section));
		this.wet = sections[0]?.bandWet === false ? 0 : 1;
		this.wetStart = this.wet;
		this.wetTarget = this.wet;
		this.wetFrames = 0;
		this.wetTotalFrames = 0;
	}

	retarget(sections, transitionFrames, bypassFrames) {
		if (sections.length !== this.sections.length || sections[0]?.bandId !== this.id) {
			throw new Error('Cannot retarget a parametric EQ band with a different topology.');
		}
		for (let index = 0; index < sections.length; index += 1) {
			this.sections[index].retarget(sections[index].tpt, transitionFrames);
		}
		const wetTarget = sections[0]?.bandWet === false ? 0 : 1;
		if (wetTarget !== this.wetTarget) {
			this.wetStart = this.wet;
			this.wetTarget = wetTarget;
			this.wetFrames = bypassFrames;
			this.wetTotalFrames = bypassFrames;
			if (bypassFrames === 0) this.wet = this.wetTarget;
		}
	}

	processSample(input, channel) {
		let wetOutput = input;
		for (const section of this.sections) wetOutput = section.processSample(wetOutput, channel);
		return input + (wetOutput - input) * this.wet;
	}

	advanceFrame() {
		for (const section of this.sections) section.advanceFrame();
		if (this.wetFrames > 0) {
			this.wetFrames -= 1;
			const progress = 1 - this.wetFrames / this.wetTotalFrames;
			const mix = 0.5 - 0.5 * Math.cos(Math.PI * progress);
			this.wet = this.wetStart + (this.wetTarget - this.wetStart) * mix;
			if (this.wetFrames === 0) this.wet = this.wetTarget;
		}
	}

	reset() {
		for (const section of this.sections) section.reset();
	}

	flushSmallStates() {
		for (const section of this.sections) section.flushSmallStates();
	}
}

class TptSection {
	constructor(section) {
		this.bandId = section.bandId;
		this.values = Float64Array.of(
			section.tpt.g,
			section.tpt.k,
			section.tpt.m0,
			section.tpt.m1,
			section.tpt.m2,
		);
		this.targets = this.values.slice();
		this.steps = new Float64Array(5);
		this.remainingFrames = 0;
		this.states = new Float64Array(MAX_CHANNELS * 2);
	}

	retarget(tpt, transitionFrames) {
		const target = [tpt.g, tpt.k, tpt.m0, tpt.m1, tpt.m2];
		this.remainingFrames = transitionFrames;
		for (let index = 0; index < target.length; index += 1) {
			this.targets[index] = target[index];
			this.steps[index] = transitionFrames > 0
				? (target[index] - this.values[index]) / transitionFrames
				: 0;
			if (transitionFrames === 0) this.values[index] = target[index];
		}
	}

	processSample(input, channel) {
		const stateOffset = channel * 2;
		const state1 = this.states[stateOffset];
		const state2 = this.states[stateOffset + 1];
		const [g, k, m0, m1, m2] = this.values;
		const denominator = 1 + g * (g + k);
		const high = (input - (g + k) * state1 - state2) / denominator;
		const band = state1 + g * high;
		const low = state2 + g * band;
		this.states[stateOffset] = 2 * band - state1;
		this.states[stateOffset + 1] = 2 * low - state2;
		return m0 * high + m1 * band + m2 * low;
	}

	advanceFrame() {
		if (this.remainingFrames > 0) {
			for (let index = 0; index < this.values.length; index += 1) this.values[index] += this.steps[index];
			this.remainingFrames -= 1;
			if (this.remainingFrames === 0) this.values.set(this.targets);
		}
	}

	reset() {
		this.states.fill(0);
	}

	flushSmallStates() {
		for (let index = 0; index < this.states.length; index += 1) {
			if (Math.abs(this.states[index]) < STATE_FLUSH_THRESHOLD) this.states[index] = 0;
		}
	}
}

function groupSections(sections) {
	const groups = [];
	for (const section of sections) {
		const previous = groups[groups.length - 1];
		if (previous?.[0]?.bandId === section.bandId) previous.push(section);
		else groups.push([section]);
	}
	return groups;
}

function normalizeInputChannels(channels) {
	if (!Array.isArray(channels)) throw new TypeError('Parametric EQ channels must be an array.');
	return channels.map((channel) => {
		if (channel instanceof Float32Array || channel instanceof Float64Array) return channel;
		if (ArrayBuffer.isView(channel) || Array.isArray(channel)) return Float32Array.from(channel);
		throw new TypeError('Parametric EQ channels must contain numeric typed arrays.');
	});
}

function normalizeSampleRate(value) {
	const sampleRate = Number(value);
	if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
		throw new RangeError('Parametric EQ sample rate must be between 8,000 and 768,000 Hz.');
	}
	return sampleRate;
}

function normalizeFrames(value, fallback) {
	if (value == null) return fallback;
	const frames = Number(value);
	if (!Number.isFinite(frames)) return fallback;
	return Math.max(0, Math.min(1_000_000, Math.round(frames)));
}
