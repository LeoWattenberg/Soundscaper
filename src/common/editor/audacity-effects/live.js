/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Stateful, block-stable adaptations of the Audacity 3.7.7 processing
 * business logic pinned in manifest.js. See THIRD_PARTY_LICENSES.md.
 */

import {
	audacityEffectDefaults,
	audacityEffectTypes,
	normalizeAudacityEffectParams,
} from './manifest.js';
import {
	applyAudacityFilterCurveEq,
	applyAudacityGraphicEq,
	applyAudacityNoiseReduction,
} from './spectral.js';
import { fft } from '../pffft.js';

const CLICK_WINDOW_SIZE = 8_192;
const CLICK_HOP_SIZE = 4_096;
const EQ_PARTITION_SIZE = 128;
const NOISE_WINDOW_SIZE = 2_048;
const NOISE_HOP_SIZE = 512;
const NOISE_CHUNK_SIZE = 4_096;
const RMS_WINDOW_SIZE = 100;
const DISTORTION_STEPS = 1_024;
const DISTORTION_TABLE_SIZE = DISTORTION_STEPS * 2 + 1;
const PHASER_LFO_SHAPE = 4;
const MAX_LIVE_DELAY_SECONDS = 10;

const LIVE_TYPES = new Set([
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-noise-reduction',
	'audacity-phaser',
	'audacity-classic-filters',
	'audacity-wahwah',
]);

const SELECTION_ONLY_REASONS = Object.freeze({
	'audacity-amplify': 'The no-clipping gain depends on the complete selection peak.',
	'audacity-fade-in': 'The gain curve depends on selection position and length.',
	'audacity-fade-out': 'The gain curve depends on the future selection boundary.',
	'audacity-legacy-compressor': 'The algorithm performs whole-selection and backwards passes.',
	'audacity-loudness-normalization': 'The gain depends on complete-program loudness.',
	'audacity-normalize': 'DC offset and peak gain depend on complete-selection statistics.',
	'audacity-paulstretch': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-repair': 'Repair requires an explicitly marked short damaged selection and surrounding context.',
	'audacity-repeat': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-reverse': 'The first output sample depends on the end of the complete selection.',
	'audacity-truncate-silence': 'The effect removes time and cannot be a one-in/one-out insert.',
});

const liveCapabilities = Object.fromEntries(audacityEffectTypes().map((type) => {
	const live = LIVE_TYPES.has(type);
	return [type, Object.freeze({
		type,
		mode: live ? 'live' : 'selection-only',
		live,
		inputCount: type === 'audacity-auto-duck' ? 2 : 1,
		requiresSidechain: type === 'audacity-auto-duck',
		requiresNoiseProfile: type === 'audacity-noise-reduction',
		paramRanges: freezeParamRanges(liveParamRanges(type)),
		reason: live ? null : SELECTION_ONLY_REASONS[type] || 'This effect requires render-ahead selection processing.',
		latencyFrames: (sampleRate, params = {}) => liveLatencyFrames(type, sampleRate, params),
		tailFrames: (sampleRate, params = {}) => liveTailFrames(type, sampleRate, params),
	})];
}));

export const AUDACITY_LIVE_EFFECT_CAPABILITIES = Object.freeze(liveCapabilities);

export function audacityLiveEffectCapability(type) {
	const capability = AUDACITY_LIVE_EFFECT_CAPABILITIES[type];
	if (!capability) throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	return capability;
}

export function isAudacityLiveEffect(type) {
	return Boolean(AUDACITY_LIVE_EFFECT_CAPABILITIES[type]?.live);
}

export function audacityLiveEffectLatencyFrames(type, sampleRate, params = {}) {
	return audacityLiveEffectCapability(type).latencyFrames(sampleRate, params);
}

export function audacityLiveEffectTailFrames(type, sampleRate, params = {}) {
	return audacityLiveEffectCapability(type).tailFrames(sampleRate, params);
}

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

class LiveProcessor {
	constructor(type, sampleRate, params) {
		this.type = type;
		this.sampleRate = sampleRate;
		this.params = params;
		this.latencyFrames = liveLatencyFrames(type, sampleRate, params);
		this.tailFrames = liveTailFrames(type, sampleRate, params);
	}

	updateParams(params = {}) {
		const normalized = normalizeAudacityEffectParams(this.type, {
			...this.params,
			...params,
		});
		validateLiveParamRanges(audacityLiveEffectCapability(this.type), normalized);
		this.params = normalized;
		this.latencyFrames = liveLatencyFrames(this.type, this.sampleRate, this.params);
		this.tailFrames = liveTailFrames(this.type, this.sampleRate, this.params);
		this.configure();
		this.reset();
	}

	setNoiseProfile() {
		throw new RangeError(`${this.type} does not use a noise profile.`);
	}

	configure() {}
	reset() {}
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
			for (let frame = 0; frame < frames; frame += 1) {
				const dry = source?.[frame] || 0;
				let sample = dry + state.feedback * this.params.feedbackPercent / 101;
				const update = state.skip % 20 === 0;
				state.skip += 1;
				if (update) {
					state.gain = (1 + Math.cos(state.skip * this.lfoStep + this.phase)) / 2;
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
			for (let frame = 0; frame < frames; frame += 1) {
				const update = state.skip % 30 === 0;
				state.skip += 1;
				if (update) {
					let center = (1 + Math.cos(state.skip * this.lfoStep + this.phase)) / 2;
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

class DynamicsLiveProcessor extends LiveProcessor {
	constructor(type, sampleRate, params) {
		super(type, sampleRate, params);
		this.configure();
		this.reset();
	}
	configure() {
		const compressor = this.type === 'audacity-compressor';
		this.thresholdDb = this.params.thresholdDb;
		this.makeupGainDb = compressor
			? this.params.makeupGainDb
			: this.params.makeupTargetDb - this.params.thresholdDb;
		this.kneeWidthDb = this.params.kneeWidthDb;
		this.ratio = compressor ? this.params.ratio : Number.POSITIVE_INFINITY;
		this.lookaheadFrames = Math.trunc(this.params.lookaheadMs * this.sampleRate / 1_000);
		const attackSeconds = compressor ? this.params.attackMs / 1_000 : 0;
		const releaseSeconds = this.params.releaseMs / 1_000;
		this.alphaAttack = attackSeconds === 0 ? 1 : 1 - Math.exp(-1 / (this.sampleRate * attackSeconds));
		this.alphaRelease = releaseSeconds === 0 ? 1 : 1 - Math.exp(-1 / (this.sampleRate * releaseSeconds));
		this.slope = Number.isFinite(this.ratio) ? 1 / this.ratio - 1 : -1;
		this.kneeHalf = this.kneeWidthDb / 2;
	}
	reset() {
		this.envelopeState = 0;
		this.envelopeHistory = new Float64Array(this.lookaheadFrames);
		this.audioHistory = [];
		this.framesSeen = 0;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.audioHistory.length !== output.length) {
			this.audioHistory = Array.from({ length: output.length }, () => new Float32Array(this.lookaheadFrames));
			this.envelopeHistory.fill(0);
			this.envelopeState = 0;
			this.framesSeen = 0;
		}
		const combinedEnvelope = new Float64Array(this.lookaheadFrames + frames);
		combinedEnvelope.set(this.envelopeHistory);
		const combinedAudio = output.map((_, channel) => {
			const values = new Float32Array(this.lookaheadFrames + frames);
			values.set(this.audioHistory[channel]);
			const source = channelAt(input, channel);
			if (source) values.set(source, this.lookaheadFrames);
			return values;
		});
		for (let frame = 0; frame < frames; frame += 1) {
			let sidechain = 0;
			for (const channel of input) sidechain = Math.max(sidechain, Math.abs(channel[frame] || 0));
			const levelDb = sidechain === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(sidechain);
			const overshoot = levelDb - this.thresholdDb;
			let gainReduction;
			if (overshoot <= -this.kneeHalf) gainReduction = 0;
			else if (overshoot <= this.kneeHalf && this.kneeWidthDb > 0) gainReduction = 0.5 * this.slope * (overshoot + this.kneeHalf) ** 2 / this.kneeWidthDb;
			else gainReduction = this.slope * overshoot;
			const difference = gainReduction - this.envelopeState;
			this.envelopeState += (difference < 0 ? this.alphaAttack : this.alphaRelease) * difference;
			combinedEnvelope[this.lookaheadFrames + frame] = this.envelopeState;
		}
		const transformed = new Float64Array(combinedEnvelope);
		if (this.lookaheadFrames > 0) applyLookaheadEnvelope(transformed, this.lookaheadFrames);
		for (let channel = 0; channel < output.length; channel += 1) {
			for (let frame = 0; frame < frames; frame += 1) {
				output[channel][frame] = this.framesSeen + frame < this.lookaheadFrames
					? 0
					: combinedAudio[channel][frame] * dbToLinear(transformed[frame] + this.makeupGainDb);
			}
			if (this.lookaheadFrames > 0) this.audioHistory[channel].set(combinedAudio[channel].subarray(frames));
		}
		if (this.lookaheadFrames > 0) this.envelopeHistory.set(combinedEnvelope.subarray(frames));
		this.framesSeen += frames;
		return true;
	}
}

class AutoDuckLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-auto-duck', sampleRate, params); this.configure(); this.reset(); }
	configure() {
		this.outerDown = secondsToFrames(this.params.outerFadeDown, this.sampleRate);
		this.outerUp = secondsToFrames(this.params.outerFadeUp, this.sampleRate);
		this.fadeDown = Math.max(1, secondsToFrames(this.params.outerFadeDown + this.params.innerFadeDown, this.sampleRate));
		this.fadeUp = Math.max(1, secondsToFrames(this.params.outerFadeUp + this.params.innerFadeUp, this.sampleRate));
		this.minimumPause = secondsToFrames(Math.max(this.params.maximumPause, this.params.outerFadeDown + this.params.outerFadeUp), this.sampleRate);
		this.delayFrames = Math.max(this.outerDown, this.minimumPause + secondsToFrames(this.params.innerFadeUp, this.sampleRate));
		if (this.delayFrames > this.sampleRate * MAX_LIVE_DELAY_SECONDS) {
			throw new RangeError(`Live Auto Duck lookahead is limited to ${MAX_LIVE_DELAY_SECONDS} seconds.`);
		}
		this.thresholdPower = basicDbToLinear(this.params.thresholdDb) ** 2 * RMS_WINDOW_SIZE;
	}
	reset() {
		this.programRings = [];
		this.rmsWindow = new Float64Array(RMS_WINDOW_SIZE);
		this.rmsPosition = 0;
		this.rmsSum = 0;
		this.frame = 0;
		this.openRegion = null;
		this.completedRegions = [];
		this.pauseFrames = 0;
	}
	process(input, output, sidechain = []) {
		const frames = validateBlock(input, output);
		for (const channel of sidechain) if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Auto Duck sidechain channels must match the program block.');
		const ringLength = this.delayFrames + 1;
		ensureArrayLength(this.programRings, output.length, () => new Float32Array(ringLength));
		const control = sidechain[0];
		for (let blockFrame = 0; blockFrame < frames; blockFrame += 1) {
			const absoluteFrame = this.frame;
			const writePosition = absoluteFrame % ringLength;
			for (let channel = 0; channel < output.length; channel += 1) this.programRings[channel][writePosition] = channelAt(input, channel)?.[blockFrame] || 0;
			this.rmsSum -= this.rmsWindow[this.rmsPosition];
			const controlSample = control?.[blockFrame] || 0;
			const square = controlSample * controlSample;
			this.rmsWindow[this.rmsPosition] = square;
			this.rmsSum += square;
			this.rmsPosition = (this.rmsPosition + 1) % RMS_WINDOW_SIZE;
			if (absoluteFrame >= this.outerDown) this.#updateRegion(this.rmsSum > this.thresholdPower, absoluteFrame);

			const logicalFrame = absoluteFrame - this.delayFrames;
			if (logicalFrame < 0) {
				for (const channel of output) channel[blockFrame] = 0;
			} else {
				const gain = basicDbToLinear(this.#gainDbAt(logicalFrame));
				const readPosition = logicalFrame % ringLength;
				for (let channel = 0; channel < output.length; channel += 1) output[channel][blockFrame] = this.programRings[channel][readPosition] * gain;
			}
			this.frame += 1;
		}
		return true;
	}
	#updateRegion(exceeded, frame) {
		if (exceeded) {
			this.pauseFrames = 0;
			if (!this.openRegion) this.openRegion = { start: frame - this.outerDown };
			return;
		}
		if (!this.openRegion) return;
		this.pauseFrames += 1;
		if (this.pauseFrames >= this.minimumPause) {
			this.completedRegions.push({
				start: this.openRegion.start,
				end: frame - this.pauseFrames + this.outerUp,
			});
			this.openRegion = null;
			this.pauseFrames = 0;
		}
	}
	#gainDbAt(frame) {
		while (this.completedRegions.length && this.completedRegions[0].end <= frame) this.completedRegions.shift();
		for (const region of this.completedRegions) {
			if (frame >= region.start && frame < region.end) return regionGainDb(frame, region, this.params.duckAmountDb, this.fadeDown, this.fadeUp);
		}
		if (this.openRegion && frame >= this.openRegion.start) {
			const gainDown = this.params.duckAmountDb * (frame - this.openRegion.start) / this.fadeDown;
			return Math.max(this.params.duckAmountDb, gainDown);
		}
		return 0;
	}
}

class ClickRemovalLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-click-removal', sampleRate, params); this.reset(); }
	reset() {
		this.overlap = null;
		this.incoming = [];
		this.outputQueues = [];
		this.separation = 2_049;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.params.threshold === 0 || this.params.maximumWidth === 0) {
			copyBlock(input, output, frames);
			return true;
		}
		if (this.incoming.length !== output.length) {
			this.overlap = null;
			this.incoming = Array.from({ length: output.length }, () => []);
			this.outputQueues = Array.from({ length: output.length }, () => new SampleQueue());
			this.separation = 2_049;
		}
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) this.incoming[channel].push(channelAt(input, channel)?.[frame] || 0);
			const needed = this.overlap ? CLICK_HOP_SIZE : CLICK_WINDOW_SIZE;
			if (this.incoming[0].length === needed) this.#processWindow();
			for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = this.outputQueues[channel].shift(0);
		}
		return true;
	}
	#processWindow() {
		const nextOverlap = [];
		for (let channel = 0; channel < this.incoming.length; channel += 1) {
			const window = new Float32Array(CLICK_WINDOW_SIZE);
			if (this.overlap) window.set(this.overlap[channel]);
			window.set(this.incoming[channel], this.overlap ? CLICK_HOP_SIZE : 0);
			this.separation = removeClicksFromWindow(window, this.params.threshold, this.params.maximumWidth, this.separation);
			this.outputQueues[channel].push(window.subarray(0, CLICK_HOP_SIZE));
			nextOverlap.push(window.slice(CLICK_HOP_SIZE));
			this.incoming[channel] = [];
		}
		this.overlap = nextOverlap;
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

const DISTORTION_MODES = Object.freeze([
	'hard-clipping', 'soft-clipping', 'soft-overdrive', 'medium-overdrive',
	'hard-overdrive', 'cubic', 'even-harmonics', 'expand-compress', 'leveller',
	'rectifier', 'hard-limiter',
]);

function makeDistortionTable(settings) {
	const table = new Float64Array(DISTORTION_TABLE_SIZE);
	const mode = DISTORTION_MODES.indexOf(settings.mode);
	let makeupGain = 1;
	const copyPositiveHalf = () => {
		let source = DISTORTION_TABLE_SIZE - 1;
		for (let index = 0; index < DISTORTION_STEPS; index += 1) table[index] = -table[source--];
	};
	if (mode === 0 || mode === 10) {
		const threshold = dbToLinear(settings.thresholdDb);
		const low = 1 - threshold;
		const high = 1 + threshold;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			if (index < DISTORTION_STEPS * low) table[index] = -threshold;
			else if (index > DISTORTION_STEPS * high) table[index] = threshold;
			else table[index] = index / DISTORTION_STEPS - 1;
		}
		makeupGain = 1 / threshold;
	} else if (mode === 1) {
		const threshold = dbToLinear(settings.thresholdDb);
		const tableThreshold = 1 + threshold;
		const amount = 2 ** (7 * settings.parameter1 / 100);
		const curve = (value) => Math.fround(threshold + (Math.exp(amount * (threshold - value)) - 1) / -amount);
		makeupGain = 1 / curve(1);
		table[DISTORTION_STEPS] = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			const value = index / DISTORTION_STEPS - 1;
			table[index] = index < DISTORTION_STEPS * tableThreshold ? value : curve(value);
		}
		copyPositiveHalf();
	} else if (mode === 2) {
		const iterations = Math.floor(settings.parameter1 / 20);
		const fraction = settings.parameter1 / 20 - iterations;
		let linear = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			let value = linear;
			for (let pass = 0; pass < iterations; pass += 1) value = Math.sin(value * Math.PI / 2);
			value += (Math.sin(value * Math.PI / 2) - value) * fraction;
			table[index] = value;
			linear += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 3) {
		const amount = Math.min(0.999, dbToLinear(-settings.parameter1));
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			const linear = index / DISTORTION_STEPS;
			table[index] = -1 / (1 - amount) * (Math.exp((linear - 1) * Math.log(amount)) - 1);
		}
		copyPositiveHalf();
	} else if (mode === 4) {
		let linear = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = settings.parameter1 === 0 ? linear : Math.log(1 + settings.parameter1 * linear) / Math.log(1 + settings.parameter1);
			linear += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 5) {
		const amount = settings.parameter1 * Math.sqrt(3) / 100;
		const cubic = (value) => settings.parameter1 === 0 ? value : value - value ** 3 / 3;
		const gain = amount === 0 ? 1 : 1 / cubic(Math.min(amount, 1));
		let value = -amount;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = gain * cubic(value);
			for (let repeat = 0; repeat < settings.repeats; repeat += 1) table[index] = gain * cubic(table[index] * amount);
			value += amount / DISTORTION_STEPS;
		}
	} else if (mode === 6) {
		const amount = settings.parameter1 / -100;
		const shape = Math.max(0.001, settings.parameter2) / 10;
		let value = -1;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = (1 + amount) * value - value * (amount / Math.tanh(shape)) * Math.tanh(shape * value);
			value += 1 / DISTORTION_STEPS;
		}
	} else if (mode === 7) {
		const iterations = Math.floor(settings.parameter1 / 20);
		const fraction = settings.parameter1 / 20 - iterations;
		let linear = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			let value = linear;
			for (let pass = 0; pass < iterations; pass += 1) value = (1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2;
			value += ((1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2 - value) * fraction;
			table[index] = value;
			linear += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 8) {
		const noiseFloor = dbToLinear(settings.noiseFloorDb);
		const gainFactors = [0.8, 1, 1.2, 1.2, 1, 0.8];
		const gainLimits = [0.0001, noiseFloor, 0.1, 0.3, 0.5, 1];
		const addOns = [0];
		for (let index = 0; index + 1 < gainFactors.length; index += 1) addOns[index + 1] = addOns[index] + gainLimits[index] * (gainFactors[index] - gainFactors[index + 1]);
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			let value = (index - DISTORTION_STEPS) / DISTORTION_STEPS;
			for (let pass = 0; pass < settings.repeats; pass += 1) {
				const gainIndex = levellerGainIndex(value, gainLimits);
				value = value * gainFactors[gainIndex] + addOns[gainIndex];
			}
			const fraction = settings.parameter1 / 100;
			if (fraction > 0.001) {
				const gainIndex = levellerGainIndex(value, gainLimits);
				value += fraction * (value * (gainFactors[gainIndex] - 1) + addOns[gainIndex]);
			}
			table[index] = value;
		}
		copyPositiveHalf();
	} else if (mode === 9) {
		const amount = settings.parameter1 / 50 - 1;
		for (let index = 0; index <= DISTORTION_STEPS; index += 1) table[DISTORTION_STEPS + index] = index / DISTORTION_STEPS;
		for (let index = 1; index <= DISTORTION_STEPS; index += 1) table[DISTORTION_STEPS - index] = index / DISTORTION_STEPS * amount;
	}
	return { table, makeupGain };
}

function levellerGainIndex(value, limits) {
	let index = limits.length - 1;
	for (let candidate = index; candidate >= 0 && value < limits[candidate]; candidate -= 1) index = candidate;
	return index;
}

function distortionWaveShaper(input, table, mode, parameter1) {
	let sample = input;
	if (mode === 0) sample = Math.fround(sample * (1 + parameter1 / 100));
	let index = Math.floor(sample * DISTORTION_STEPS) + DISTORTION_STEPS;
	index = Math.max(0, Math.min(index, DISTORTION_STEPS * 2 - 1));
	let offset = Math.fround(1 + sample) * DISTORTION_STEPS - index;
	offset = Math.max(0, Math.min(offset, 1));
	return Math.fround(table[index] + (table[index + 1] - table[index]) * offset);
}

function createDcState(length) { return { samples: new Float32Array(length), length, size: 0, position: 0, total: 0 }; }
function dcFilter(sample, state) {
	state.total += sample;
	if (state.size < state.length) { state.samples[state.position] = sample; state.size += 1; }
	else { state.total -= state.samples[state.position]; state.samples[state.position] = sample; }
	state.position = (state.position + 1) % state.length;
	return sample - state.total / state.size;
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

function classicFilterCoefficients(settings, nyquist) {
	const subtype = settings.direction === 'lowpass' ? 0 : 1;
	if (settings.family === 'butterworth') return butterworthCoefficients(settings.order, nyquist, settings.cutoffHz, subtype);
	if (settings.family === 'chebyshev-i') return chebyshevOneCoefficients(settings.order, nyquist, settings.cutoffHz, settings.passbandRippleDb, subtype);
	return chebyshevTwoCoefficients(settings.order, nyquist, settings.cutoffHz, settings.stopbandAttenuationDb, subtype);
}

function createBiquads(order) { return Array.from({ length: Math.floor((order + 1) / 2) }, () => ({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })); }
function normalizedCutoff(nyquist, cutoff) { return Math.min(cutoff / nyquist, 0.9999); }

function butterworthCoefficients(order, nyquist, cutoff, subtype) {
	const sections = createBiquads(order);
	const warped = Math.tan(Math.PI * normalizedCutoff(nyquist, cutoff) / 2);
	let poleDistance = 1;
	if (order % 2 === 0) {
		for (let pair = 0; pair < order / 2; pair += 1) {
			const pole = bilinearTransform(warped * Math.cos(Math.PI - (pair + 0.5) * Math.PI / order), warped * Math.sin(Math.PI - (pair + 0.5) * Math.PI / order));
			setButterworthPair(sections[pair], pole, subtype);
			poleDistance *= distanceSquared(subtype === 0 ? 1 : -1, 0, pole[0], pole[1]);
		}
	} else {
		const pole = bilinearTransform(-warped, 0);
		sections[0] = { b0: 1, b1: subtype === 0 ? 1 : -1, b2: 0, a1: -pole[0], a2: 0 };
		poleDistance = subtype === 0 ? 1 - pole[0] : pole[0] + 1;
		for (let pair = 1; pair <= Math.floor(order / 2); pair += 1) {
			const pairPole = bilinearTransform(warped * Math.cos(Math.PI - pair * Math.PI / order), warped * Math.sin(Math.PI - pair * Math.PI / order));
			setButterworthPair(sections[pair], pairPole, subtype);
			poleDistance *= distanceSquared(subtype === 0 ? 1 : -1, 0, pairPole[0], pairPole[1]);
		}
	}
	const scale = poleDistance / 2 ** order;
	sections[0].b0 *= scale; sections[0].b1 *= scale; sections[0].b2 *= scale;
	return sections;
}

function setButterworthPair(section, pole, subtype) {
	section.b0 = 1; section.b1 = subtype === 0 ? 2 : -2; section.b2 = 1;
	section.a1 = -2 * pole[0]; section.a2 = pole[0] ** 2 + pole[1] ** 2;
}

function chebyshevOneCoefficients(order, nyquist, cutoff, ripple, subtype) {
	const sections = createBiquads(order);
	const normalized = normalizedCutoff(nyquist, cutoff);
	const warped = Math.tan(Math.PI * normalized / 2);
	const beta = Math.cos(normalized * Math.PI);
	const epsilon = Math.sqrt(10 ** (Math.max(0.001, ripple) / 10) - 1);
	const scale = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;
	for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
		const x = -warped * Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order));
		const y = warped * Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order));
		let pole = bilinearTransform(x, y);
		let zero;
		let distance;
		if (subtype === 0) { zero = -1; distance = distanceSquared(1, 0, pole[0], pole[1]) / 4; }
		else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zero = 1; distance = distanceSquared(-1, 0, pole[0], pole[1]) / 4;
		}
		sections[pair] = { b0: distance, b1: -2 * zero * distance, b2: distance, a1: -2 * pole[0], a2: pole[0] ** 2 + pole[1] ** 2 };
	}
	if (order % 2 === 0) {
		const attenuation = dbToLinear(-Math.max(0.001, ripple));
		sections[0].b0 *= attenuation; sections[0].b1 *= attenuation; sections[0].b2 *= attenuation;
	} else {
		let pole = bilinearTransform(-warped * Math.sinh(scale), 0);
		let zero;
		let distance;
		if (subtype === 0) { zero = -1; distance = Math.sqrt(distanceSquared(1, 0, pole[0], pole[1])) / 2; }
		else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zero = 1; distance = Math.sqrt(distanceSquared(-1, 0, pole[0], pole[1])) / 2;
		}
		sections[Math.floor((order - 1) / 2)] = { b0: distance, b1: -zero * distance, b2: 0, a1: -pole[0], a2: 0 };
	}
	return sections;
}

function chebyshevTwoCoefficients(order, nyquist, cutoff, ripple, subtype) {
	const sections = createBiquads(order);
	const normalized = normalizedCutoff(nyquist, cutoff);
	const warped = Math.tan(Math.PI * normalized / 2);
	const beta = Math.cos(normalized * Math.PI);
	const epsilon = dbToLinear(-Math.max(0.001, ripple));
	const scale = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;
	let poleX;
	let poleY;
	for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
		[poleX, poleY] = complexDivide(warped, 0, -Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order)), Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order)));
		let pole = bilinearTransform(poleX, poleY);
		let zero = bilinearTransform(0, warped / Math.cos((2 * pair + 1) * Math.PI / (2 * order)));
		let distance;
		if (subtype === 0) distance = distanceSquared(1, 0, pole[0], pole[1]) / distanceSquared(1, 0, zero[0], zero[1]);
		else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zero = complexDivide(beta - zero[0], -zero[1], 1 - beta * zero[0], -beta * zero[1]);
			distance = distanceSquared(-1, 0, pole[0], pole[1]) / distanceSquared(-1, 0, zero[0], zero[1]);
		}
		sections[pair] = { b0: distance, b1: -2 * zero[0] * distance, b2: (zero[0] ** 2 + zero[1] ** 2) * distance, a1: -2 * pole[0], a2: pole[0] ** 2 + pole[1] ** 2 };
	}
	if (order % 2 === 1) {
		const pair = Math.floor((order - 1) / 2);
		[poleX, poleY] = complexDivide(warped, 0, -Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order)), Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order)));
		let pole = bilinearTransform(poleX, poleY);
		let zero;
		let distance;
		if (subtype === 0) { zero = -1; distance = Math.sqrt(distanceSquared(1, 0, pole[0], pole[1])) / 2; }
		else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -pole[1]);
			zero = 1; distance = Math.sqrt(distanceSquared(-1, 0, pole[0], pole[1])) / 2;
		}
		sections[pair] = { b0: distance, b1: -zero * distance, b2: 0, a1: -pole[0], a2: 0 };
	}
	return sections;
}

function complexDivide(nr, ni, dr, di) {
	const denominator = dr ** 2 + di ** 2;
	return [(nr * dr + ni * di) / denominator, (ni * dr - nr * di) / denominator];
}
function bilinearTransform(x, y) {
	const denominator = (1 - x) ** 2 + y ** 2;
	return [(1 - x ** 2 - y ** 2) / denominator, 2 * y / denominator];
}
function distanceSquared(x1, y1, x2, y2) { return Math.fround((x1 - x2) ** 2 + (y1 - y2) ** 2); }

class EqualizerLiveProcessor extends LiveProcessor {
	constructor(type, sampleRate, params) { super(type, sampleRate, params); this.configure(); this.reset(); }
	configure() {
		this.kernel = buildLiveEqualizerKernel(this.type, this.sampleRate, this.params);
		this.centerDelay = (this.kernel.length - 1) / 2;
		this.kernelPartitions = partitionKernel(this.kernel, EQ_PARTITION_SIZE);
	}
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => createPartitionState(this.kernelPartitions.length, EQ_PARTITION_SIZE, this.centerDelay));
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) {
				const state = this.states[channel];
				state.input[state.inputFill++] = channelAt(input, channel)?.[frame] || 0;
				if (state.inputFill === EQ_PARTITION_SIZE) processConvolutionPartition(state, this.kernelPartitions, EQ_PARTITION_SIZE);
				output[channel][frame] = state.started ? state.queue.shift(0) : 0;
			}
		}
		return true;
	}
}

function buildLiveEqualizerKernel(type, sampleRate, params) {
	const length = params.filterLength;
	const impulse = new Float32Array(length);
	impulse[(length - 1) / 2] = 1;
	return type === 'audacity-filter-curve-eq'
		? applyAudacityFilterCurveEq([impulse], sampleRate, params)[0]
		: applyAudacityGraphicEq([impulse], sampleRate, params)[0];
}

function partitionKernel(kernel, partitionSize) {
	const fftSize = partitionSize * 2;
	const count = Math.ceil(kernel.length / partitionSize);
	return Array.from({ length: count }, (_, partition) => {
		const real = new Float64Array(fftSize);
		const imaginary = new Float64Array(fftSize);
		real.set(kernel.subarray(partition * partitionSize, (partition + 1) * partitionSize));
		fft(real, imaginary, false);
		return { real, imaginary };
	});
}

function createPartitionState(partitionCount, partitionSize, discard) {
	const fftSize = partitionSize * 2;
	return {
		input: new Float64Array(partitionSize),
		inputFill: 0,
		overlap: new Float64Array(partitionSize),
		historyReal: Array.from({ length: partitionCount }, () => new Float64Array(fftSize)),
		historyImaginary: Array.from({ length: partitionCount }, () => new Float64Array(fftSize)),
		historyIndex: -1,
		discard,
		queue: new SampleQueue(),
		started: false,
	};
}

function processConvolutionPartition(state, kernelPartitions, partitionSize) {
	const fftSize = partitionSize * 2;
	const inputReal = new Float64Array(fftSize);
	const inputImaginary = new Float64Array(fftSize);
	inputReal.set(state.input);
	fft(inputReal, inputImaginary, false);
	state.historyIndex = (state.historyIndex + 1) % kernelPartitions.length;
	state.historyReal[state.historyIndex].set(inputReal);
	state.historyImaginary[state.historyIndex].set(inputImaginary);
	const outputReal = new Float64Array(fftSize);
	const outputImaginary = new Float64Array(fftSize);
	for (let partition = 0; partition < kernelPartitions.length; partition += 1) {
		const historyIndex = (state.historyIndex - partition + kernelPartitions.length) % kernelPartitions.length;
		const xr = state.historyReal[historyIndex];
		const xi = state.historyImaginary[historyIndex];
		const hr = kernelPartitions[partition].real;
		const hi = kernelPartitions[partition].imaginary;
		for (let bin = 0; bin < fftSize; bin += 1) {
			outputReal[bin] += xr[bin] * hr[bin] - xi[bin] * hi[bin];
			outputImaginary[bin] += xr[bin] * hi[bin] + xi[bin] * hr[bin];
		}
	}
	fft(outputReal, outputImaginary, true);
	const causal = new Float32Array(partitionSize);
	for (let frame = 0; frame < partitionSize; frame += 1) {
		causal[frame] = outputReal[frame] + state.overlap[frame];
		state.overlap[frame] = outputReal[frame + partitionSize];
	}
	let start = 0;
	if (state.discard > 0) {
		start = Math.min(partitionSize, state.discard);
		state.discard -= start;
	}
	if (start < causal.length) state.queue.push(causal.subarray(start));
	if (!state.started && state.discard === 0 && state.queue.length >= partitionSize) state.started = true;
	state.input.fill(0);
	state.inputFill = 0;
}

class NoiseReductionLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params, profile) {
		super('audacity-noise-reduction', sampleRate, params);
		this.configure();
		this.setNoiseProfile(profile);
	}
	configure() {
		const attackBlocks = 1 + Math.floor(0.02 * this.sampleRate / NOISE_HOP_SIZE);
		const releaseBlocks = 1 + Math.floor(0.1 * this.sampleRate / NOISE_HOP_SIZE);
		this.leftContext = NOISE_WINDOW_SIZE + (2 + releaseBlocks) * NOISE_HOP_SIZE;
		this.rightContext = NOISE_WINDOW_SIZE + (2 + attackBlocks) * NOISE_HOP_SIZE;
	}
	setNoiseProfile(profile) {
		const serializedPowers = profile?.meanPowers;
		const meanPowers = serializedPowers instanceof Float32Array
			? new Float32Array(serializedPowers)
			: Array.isArray(serializedPowers) ? Float32Array.from(serializedPowers) : null;
		if (!profile || profile.type !== 'audacity-noise-profile' || profile.version !== 1 || !meanPowers) {
			throw new TypeError('Live Noise Reduction requires a captured Audacity noise profile.');
		}
		if (profile.sampleRate !== this.sampleRate || profile.windowSize !== NOISE_WINDOW_SIZE || profile.stepsPerWindow !== 4 || meanPowers.length !== NOISE_WINDOW_SIZE / 2 + 1) {
			throw new RangeError('The live Noise Reduction profile uses incompatible analysis settings.');
		}
		for (const power of meanPowers) if (!Number.isFinite(power) || power < 0) throw new RangeError('The live Noise Reduction profile spectrum is invalid.');
		this.profile = {
			...profile,
			meanPowers,
		};
		this.reset();
	}
	reset() {
		this.data = [];
		this.outputQueues = [];
		this.baseFrame = 0;
		this.totalFrames = 0;
		this.nextChunkStart = 0;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.data.length !== output.length) {
			this.data = Array.from({ length: output.length }, () => []);
			this.outputQueues = Array.from({ length: output.length }, () => new SampleQueue());
			this.baseFrame = 0;
			this.totalFrames = 0;
			this.nextChunkStart = 0;
		}
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) this.data[channel].push(channelAt(input, channel)?.[frame] || 0);
			this.totalFrames += 1;
			if (this.totalFrames >= this.nextChunkStart + NOISE_CHUNK_SIZE + this.rightContext) this.#renderChunk();
			for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = this.outputQueues[channel].shift(0);
		}
		return true;
	}
	#renderChunk() {
		const contextStart = this.nextChunkStart - this.leftContext;
		const contextLength = this.leftContext + NOISE_CHUNK_SIZE + this.rightContext;
		const channels = this.data.map((values) => {
			const channel = new Float32Array(contextLength);
			for (let frame = 0; frame < contextLength; frame += 1) {
				const sourceFrame = contextStart + frame;
				const index = sourceFrame - this.baseFrame;
				if (index >= 0 && index < values.length) channel[frame] = values[index];
			}
			return channel;
		});
		const reduced = applyAudacityNoiseReduction(channels, this.sampleRate, this.params, this.profile);
		for (let channel = 0; channel < reduced.length; channel += 1) {
			this.outputQueues[channel].push(reduced[channel].subarray(this.leftContext, this.leftContext + NOISE_CHUNK_SIZE));
		}
		this.nextChunkStart += NOISE_CHUNK_SIZE;
		const dropBefore = Math.max(0, this.nextChunkStart - this.leftContext);
		const drop = dropBefore - this.baseFrame;
		if (drop > 0) {
			for (let channel = 0; channel < this.data.length; channel += 1) this.data[channel].splice(0, drop);
			this.baseFrame = dropBefore;
		}
	}
}

function applyLookaheadEnvelope(envelope, lookaheadFrames) {
	let nextGainReduction = 0;
	let step = 0;
	for (let index = envelope.length - 1; index >= 0; index -= 1) {
		const sample = envelope[index];
		if (sample > nextGainReduction) {
			envelope[index] = nextGainReduction;
			nextGainReduction += step;
		} else {
			step = -sample / lookaheadFrames;
			nextGainReduction = sample + step;
		}
	}
}

function regionGainDb(frame, region, duckAmountDb, fadeDown, fadeUp) {
	const gainDown = duckAmountDb * (frame - region.start) / fadeDown;
	const gainUp = duckAmountDb * (region.end - frame) / fadeUp;
	return Math.max(duckAmountDb, gainDown, gainUp);
}

function removeClicksFromWindow(buffer, threshold, maximumWidth, initialSeparation) {
	const length = buffer.length;
	const centerOffset = Math.floor(initialSeparation / 2);
	let separation = 1;
	while (separation < initialSeparation) separation *= 2;
	const squares = new Float64Array(length);
	const meanSquares = new Float64Array(length - separation);
	const prefix = new Float64Array(length + 1);
	for (let index = 0; index < length; index += 1) {
		const square = buffer[index] * buffer[index];
		squares[index] = square;
		prefix[index + 1] = prefix[index] + square;
	}
	for (let index = 0; index < meanSquares.length; index += 1) meanSquares[index] = (prefix[index + separation] - prefix[index]) / separation;
	let left = 0;
	for (let reciprocal = Math.floor(maximumWidth / 4); reciprocal >= 1; reciprocal = Math.floor(reciprocal / 2)) {
		const width = Math.floor(maximumWidth / reciprocal);
		for (let index = 0; index < meanSquares.length; index += 1) {
			let local = 0;
			for (let offset = 0; offset < width; offset += 1) local += squares[index + centerOffset + offset];
			local /= width;
			if (local >= threshold * meanSquares[index] / 10) {
				if (left === 0) left = index + centerOffset;
				continue;
			}
			const right = index + width + centerOffset;
			if (left !== 0 && index - left + centerOffset <= width * 2) {
				const leftValue = buffer[left];
				const rightValue = buffer[right];
				const span = right - left;
				for (let frame = left; frame < right; frame += 1) {
					buffer[frame] = (rightValue * (frame - left) + leftValue * (right - frame)) / span;
					squares[frame] = buffer[frame] * buffer[frame];
				}
				left = 0;
			} else if (left !== 0) left = 0;
		}
	}
	return separation;
}

class SampleQueue {
	constructor() { this.values = []; this.offset = 0; }
	push(values) { for (const value of values) this.values.push(value); }
	shift(fallback = 0) {
		if (this.offset >= this.values.length) return fallback;
		const value = this.values[this.offset++];
		if (this.offset >= 8_192 && this.offset * 2 >= this.values.length) {
			this.values = this.values.slice(this.offset);
			this.offset = 0;
		}
		return value;
	}
	get length() { return this.values.length - this.offset; }
}

function copyBlock(input, output, frames) {
	for (let channel = 0; channel < output.length; channel += 1) {
		const source = channelAt(input, channel);
		if (source) output[channel].set(source);
		else output[channel].fill(0, 0, frames);
	}
}

function channelAt(channels, index) {
	return channels.length ? channels[Math.min(index, channels.length - 1)] : null;
}

function liveLatencyFrames(type, sampleRate, params) {
	validateSampleRate(sampleRate);
	if (!LIVE_TYPES.has(type)) return 0;
	const settings = normalizeAudacityEffectParams(type, { ...audacityEffectDefaults(type), ...params });
	validateLiveParamRanges({ type, paramRanges: liveParamRanges(type) }, settings);
	if (type === 'audacity-auto-duck') {
		const outerDown = secondsToFrames(settings.outerFadeDown, sampleRate);
		const innerUp = secondsToFrames(settings.innerFadeUp, sampleRate);
		const pause = secondsToFrames(Math.max(settings.maximumPause, settings.outerFadeDown + settings.outerFadeUp), sampleRate);
		return Math.max(outerDown, pause + innerUp);
	}
	if (type === 'audacity-click-removal') return settings.threshold === 0 || settings.maximumWidth === 0 ? 0 : CLICK_WINDOW_SIZE - 1;
	if (type === 'audacity-compressor' || type === 'audacity-limiter') {
		const lookahead = Math.trunc(settings.lookaheadMs * sampleRate / 1_000);
		return lookahead;
	}
	if (type === 'audacity-filter-curve-eq' || type === 'audacity-graphic-eq') {
		const delay = (settings.filterLength - 1) / 2;
		return (Math.floor(delay / EQ_PARTITION_SIZE) + 2) * EQ_PARTITION_SIZE - 1;
	}
	if (type === 'audacity-noise-reduction') {
		const attackBlocks = 1 + Math.floor(0.02 * sampleRate / NOISE_HOP_SIZE);
		const rightContext = NOISE_WINDOW_SIZE + (2 + attackBlocks) * NOISE_HOP_SIZE;
		return NOISE_CHUNK_SIZE + rightContext - 1;
	}
	return 0;
}

function liveParamRanges(type) {
	if (type === 'audacity-echo') return { delaySeconds: [0.001, MAX_LIVE_DELAY_SECONDS], decay: [0, 0.999] };
	if (type === 'audacity-auto-duck') return { maximumPause: [0, 7] };
	return {};
}

function freezeParamRanges(ranges) {
	return Object.freeze(Object.fromEntries(
		Object.entries(ranges).map(([name, limits]) => [name, Object.freeze([...limits])]),
	));
}

function validateLiveParamRanges(capability, params) {
	for (const [name, limits] of Object.entries(capability.paramRanges)) {
		const value = Number(params[name]);
		if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
			throw new RangeError(`${capability.type}.${name} must be between ${limits[0]} and ${limits[1]} for live processing.`);
		}
	}
}

function liveTailFrames(type, sampleRate, params) {
	validateSampleRate(sampleRate);
	if (!LIVE_TYPES.has(type)) return 0;
	const settings = normalizeAudacityEffectParams(type, { ...audacityEffectDefaults(type), ...params });
	validateLiveParamRanges({ type, paramRanges: liveParamRanges(type) }, settings);
	if (type === 'audacity-echo') {
		if (!(settings.decay > 0)) return 0;
		if (settings.decay >= 1) return Number.POSITIVE_INFINITY;
		return Math.floor(sampleRate * settings.delaySeconds) * Math.ceil(Math.log(0.001) / Math.log(settings.decay));
	}
	if (type === 'audacity-distortion' && settings.dcBlock) return Math.max(1, Math.floor(sampleRate / 20));
	if (type === 'audacity-filter-curve-eq' || type === 'audacity-graphic-eq') return (settings.filterLength - 1) / 2;
	return 0;
}

function validateSampleRate(value) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('sampleRate must be a positive finite number.');
}

function validateBlock(input, output) {
	if (!Array.isArray(input) || !Array.isArray(output) || output.length === 0) throw new TypeError('Input and output channel arrays are required.');
	const frames = output[0]?.length;
	if (!Number.isInteger(frames) || frames < 0) throw new TypeError('Output channels must be typed arrays.');
	for (const channel of output) if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Output channels must be equal-length Float32Array values.');
	for (const channel of input) if (!(channel instanceof Float32Array) || channel.length !== frames) throw new RangeError('Input channels must match the output block length.');
	return frames;
}

function ensureArrayLength(array, length, factory) {
	while (array.length < length) array.push(factory(array.length));
	if (array.length > length) array.length = length;
}

function secondsToFrames(seconds, sampleRate) { return Math.round(seconds * sampleRate); }
function dbToLinear(db) { return Math.exp(Math.log(10) * db / 20); }
function basicDbToLinear(db) { return 10 ** (db / 20); }

function shelfCoefficients(frequency, slope, gainDb, sampleRate, highShelf) {
	const omega = 2 * Math.PI * frequency / sampleRate;
	const amplitude = Math.exp(Math.log(10) * gainDb / 40);
	const beta = Math.sqrt((amplitude * amplitude + 1) / slope - (amplitude - 1) ** 2);
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (!highShelf) return {
		b0: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta * sine),
		b1: 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) + (amplitude - 1) * cosine + beta * sine,
		a1: -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
		a2: (amplitude + 1) + (amplitude - 1) * cosine - beta * sine,
	};
	return {
		b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta * sine),
		b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) - (amplitude - 1) * cosine + beta * sine,
		a1: 2 * ((amplitude - 1) - (amplitude + 1) * cosine),
		a2: (amplitude + 1) - (amplitude - 1) * cosine - beta * sine,
	};
}

function processShelf(input, coefficient, state) {
	const output = Math.fround((coefficient.b0 * input + coefficient.b1 * state[0] + coefficient.b2 * state[1] - coefficient.a1 * state[2] - coefficient.a2 * state[3]) / coefficient.a0);
	state[1] = state[0]; state[0] = input; state[3] = state[2]; state[2] = output;
	return output;
}
