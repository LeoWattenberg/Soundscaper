/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Stateful, block-stable adaptations of the Audacity 3.7.7 processing
 * business logic pinned in manifest.js. See THIRD_PARTY_LICENSES.md.
 */

import {
	audacityEffectDefaults,
	normalizeAudacityEffectParams,
} from './manifest.js';
import { classicFilterCoefficients } from './classic-filter-coefficients.js';
import {
	AUDACITY_DISTORTION_MODES as DISTORTION_MODES,
	createDcState,
	dcFilter,
	distortionWaveShaper,
	makeDistortionTable,
} from './distortion-table.js';
import {
	MAX_LIVE_DELAY_SECONDS,
	audacityLiveEffectCapability,
	validateLiveParamRanges,
	validateSampleRate,
} from './live-capabilities.js';
import {
	AutoDuckLiveProcessor,
	DynamicsLiveProcessor,
} from './live-dynamics-processors.js';
import {
	ClickRemovalLiveProcessor,
	EqualizerLiveProcessor,
	NoiseReductionLiveProcessor,
} from './live-spectral-processors.js';
import {
	LiveProcessor,
	channelAt,
	dbToLinear,
	ensureArrayLength,
	processShelf,
	shelfCoefficients,
	validateBlock,
} from './live-processor-base.js';

export {
	AUDACITY_LIVE_EFFECT_CAPABILITIES,
	audacityLiveEffectCapability,
	audacityLiveEffectLatencyFrames,
	audacityLiveEffectTailFrames,
	isAudacityLiveEffect,
} from './live-capabilities.js';

const PHASER_LFO_SHAPE = 4;

export function createAudacityLiveProcessor(type, sampleRate, params = {}, options = {}) {
	const capability = audacityLiveEffectCapability(type);
	if (!capability.live) {
		throw new RangeError(`${type} is selection-only: ${capability.reason}`);
	}
	validateSampleRate(sampleRate);
	const normalized = normalizeAudacityEffectParams(type, {
		...audacityEffectDefaults(type),
		...params,
	});
	validateLiveParamRanges(capability, normalized);
	switch (type) {
		case 'audacity-auto-duck': return new AutoDuckLiveProcessor(sampleRate, normalized);
		case 'audacity-bass-treble': return new BassTrebleLiveProcessor(sampleRate, normalized);
		case 'audacity-click-removal': return new ClickRemovalLiveProcessor(sampleRate, normalized);
		case 'audacity-compressor': return new DynamicsLiveProcessor(type, sampleRate, normalized);
		case 'audacity-distortion': return new DistortionLiveProcessor(sampleRate, normalized);
		case 'audacity-echo': return new EchoLiveProcessor(sampleRate, normalized);
		case 'audacity-filter-curve-eq': return new EqualizerLiveProcessor(type, sampleRate, normalized);
		case 'audacity-graphic-eq': return new EqualizerLiveProcessor(type, sampleRate, normalized);
		case 'audacity-invert': return new InvertLiveProcessor(sampleRate, normalized);
		case 'audacity-limiter': return new DynamicsLiveProcessor(type, sampleRate, normalized);
		case 'audacity-noise-reduction': return new NoiseReductionLiveProcessor(sampleRate, normalized, options.noiseProfile);
		case 'audacity-phaser': return new PhaserLiveProcessor(sampleRate, normalized);
		case 'audacity-classic-filters': return new ClassicFilterLiveProcessor(sampleRate, normalized);
		case 'audacity-wahwah': return new WahwahLiveProcessor(sampleRate, normalized);
		default: throw new RangeError(`Unsupported live Audacity effect: ${type}.`);
	}
}

class InvertLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-invert', sampleRate, params); }
	process(input, output) {
		const frames = validateBlock(input, output);
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			for (let frame = 0; frame < frames; frame += 1) output[channel][frame] = -(source?.[frame] || 0);
		}
		return true;
	}
}

class BassTrebleLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) {
		super('audacity-bass-treble', sampleRate, params);
		this.configure();
		this.reset();
	}
	configure() {
		const slope = Math.fround(0.4);
		this.bass = shelfCoefficients(250, slope, this.params.bassDb, this.sampleRate, false);
		this.treble = shelfCoefficients(4_000, slope, this.params.trebleDb, this.sampleRate, true);
		this.outputGain = dbToLinear(this.params.volumeDb);
	}
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => ({ bass: [0, 0, 0, 0], treble: [0, 0, 0, 0] }));
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			const state = this.states[channel];
			for (let frame = 0; frame < frames; frame += 1) {
				const low = processShelf(source?.[frame] || 0, this.bass, state.bass);
				output[channel][frame] = processShelf(low, this.treble, state.treble) * this.outputGain;
			}
		}
		return true;
	}
}

class EchoLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) {
		super('audacity-echo', sampleRate, params);
		this.configure();
		this.reset();
	}
	configure() {
		this.delayFrames = Math.floor(this.sampleRate * this.params.delaySeconds);
		if (this.delayFrames < 1) throw new RangeError('Echo delay must span at least one frame.');
		if (this.delayFrames > this.sampleRate * MAX_LIVE_DELAY_SECONDS) {
			throw new RangeError(`Live Echo delay is limited to ${MAX_LIVE_DELAY_SECONDS} seconds.`);
		}
		if (this.params.decay > 0.999) throw new RangeError('Live Echo decay is limited to 0.999.');
	}
	reset() { this.histories = []; this.positions = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.histories, output.length, () => new Float32Array(this.delayFrames));
		ensureArrayLength(this.positions, output.length, () => 0);
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			const history = this.histories[channel];
			let position = this.positions[channel];
			for (let frame = 0; frame < frames; frame += 1) {
				const sample = (source?.[frame] || 0) + history[position] * this.params.decay;
				if (!Number.isFinite(sample)) throw new RangeError('Echo produced a non-finite sample; reduce Decay.');
				output[channel][frame] = sample;
				history[position] = output[channel][frame];
				position = (position + 1) % history.length;
			}
			this.positions[channel] = position;
		}
		return true;
	}
}

class PhaserLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-phaser', sampleRate, params); this.configure(); this.reset(); }
	configure() {
		this.stages = this.params.stages & ~1;
		this.lfoStep = this.params.frequency * 2 * Math.PI / this.sampleRate;
		this.phase = this.params.phaseDegrees * Math.PI / 180;
		this.outputGain = dbToLinear(this.params.outputGainDb);
	}
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => ({ old: new Float64Array(this.stages), skip: 0, gain: 0, feedback: 0 }));
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			const state = this.states[channel];
			// Every channel after the first counter-phases its LFO, as the one-shot
			// path does for Audacity's per-channel FrontRight instances.
			const channelPhase = channel > 0 ? this.phase + Math.PI : this.phase;
			for (let frame = 0; frame < frames; frame += 1) {
				const dry = source?.[frame] || 0;
				let sample = dry + state.feedback * this.params.feedbackPercent / 101;
				const update = state.skip % 20 === 0;
				state.skip += 1;
				if (update) {
					state.gain = (1 + Math.cos(state.skip * this.lfoStep + channelPhase)) / 2;
					state.gain = Math.expm1(state.gain * PHASER_LFO_SHAPE) / Math.expm1(PHASER_LFO_SHAPE);
					state.gain = 1 - state.gain / 255 * this.params.depth;
				}
				for (let stage = 0; stage < this.stages; stage += 1) {
					const previous = state.old[stage];
					state.old[stage] = state.gain * previous + sample;
					sample = previous - state.gain * state.old[stage];
				}
				state.feedback = sample;
				output[channel][frame] = this.outputGain * (sample * this.params.dryWet + dry * (255 - this.params.dryWet)) / 255;
			}
		}
		return true;
	}
}

class WahwahLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-wahwah', sampleRate, params); this.configure(); this.reset(); }
	configure() {
		this.lfoStep = this.params.frequency * 2 * Math.PI / this.sampleRate;
		this.phase = this.params.phaseDegrees * Math.PI / 180;
		this.depth = this.params.depthPercent / 100;
		this.offset = this.params.frequencyOffsetPercent / 100;
		this.outputGain = dbToLinear(this.params.outputGainDb);
	}
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => ({ skip: 0, x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 }));
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			const state = this.states[channel];
			// Every channel after the first counter-phases its LFO, as the one-shot
			// path does for Audacity's per-channel FrontRight instances.
			const channelPhase = channel > 0 ? this.phase + Math.PI : this.phase;
			for (let frame = 0; frame < frames; frame += 1) {
				const update = state.skip % 30 === 0;
				state.skip += 1;
				if (update) {
					let center = (1 + Math.cos(state.skip * this.lfoStep + channelPhase)) / 2;
					center = center * this.depth * (1 - this.offset) + this.offset;
					center = Math.exp((center - 1) * 6);
					const omega = Math.PI * center;
					const sine = Math.sin(omega);
					const cosine = Math.cos(omega);
					const alpha = sine / (2 * this.params.resonance);
					state.b0 = (1 - cosine) / 2;
					state.b1 = 1 - cosine;
					state.b2 = state.b0;
					state.a0 = 1 + alpha;
					state.a1 = -2 * cosine;
					state.a2 = 1 - alpha;
				}
				const current = source?.[frame] || 0;
				const result = (state.b0 * current + state.b1 * state.x1 + state.b2 * state.x2 - state.a1 * state.y1 - state.a2 * state.y2) / state.a0;
				state.x2 = state.x1; state.x1 = current; state.y2 = state.y1; state.y1 = result;
				output[channel][frame] = result * this.outputGain;
			}
		}
		return true;
	}
}

class DistortionLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-distortion', sampleRate, params); this.configure(); this.reset(); }
	configure() {
		const built = makeDistortionTable(this.params);
		this.table = built.table;
		this.makeupGain = built.makeupGain;
		this.mode = DISTORTION_MODES.indexOf(this.params.mode);
		this.p1 = this.params.parameter1 / 100;
		this.p2 = this.params.parameter2 / 100;
		this.dcWindow = Math.max(1, Math.floor(this.sampleRate / 20));
	}
	reset() { this.dcStates = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.dcStates, output.length, () => this.params.dcBlock ? createDcState(this.dcWindow) : null);
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			const dcState = this.dcStates[channel];
			for (let frame = 0; frame < frames; frame += 1) {
				const dry = source?.[frame] || 0;
				const shaped = distortionWaveShaper(dry, this.table, this.mode, this.params.parameter1);
				let sample;
				switch (this.mode) {
					case 0:
					case 1: sample = shaped * ((1 - this.p2) + this.makeupGain * this.p2); break;
					case 2:
					case 3:
					case 4:
					case 5:
					case 7: sample = shaped * this.p2; break;
					case 10: sample = shaped * (this.p1 - this.p2) + dry * this.p2; break;
					default: sample = shaped;
				}
				sample = Math.fround(sample);
				output[channel][frame] = dcState ? dcFilter(sample, dcState) : sample;
			}
		}
		return true;
	}
}

class ClassicFilterLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-classic-filters', sampleRate, params); this.configure(); this.reset(); }
	configure() { this.coefficients = classicFilterCoefficients(this.params, this.sampleRate / 2); }
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => this.coefficients.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 })));
		for (let channel = 0; channel < output.length; channel += 1) {
			const source = channelAt(input, channel);
			for (let frame = 0; frame < frames; frame += 1) {
				let sample = source?.[frame] || 0;
				for (let section = 0; section < this.coefficients.length; section += 1) {
					const coefficient = this.coefficients[section];
					const state = this.states[channel][section];
					const result = sample * coefficient.b0 + state.x1 * coefficient.b1 + state.x2 * coefficient.b2 - state.y1 * coefficient.a1 - state.y2 * coefficient.a2;
					state.x2 = state.x1; state.x1 = sample; state.y2 = state.y1; state.y1 = result;
					sample = Math.fround(result);
				}
				output[channel][frame] = sample;
			}
		}
		return true;
	}
}
