/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The live Audacity dynamics inserts: the compressor and limiter that share one
 * lookahead gain envelope, and Auto Duck's forward scan over its sidechain. Both
 * run one block in and one block out at a declared latency, so each keeps the
 * whole envelope it will need before it emits a sample. Split out of live.js; no
 * behaviour changes here.
 */

import { MAX_LIVE_DELAY_SECONDS } from './live-capabilities.js';
import {
	LiveProcessor,
	basicDbToLinear,
	channelAt,
	dbToLinear,
	ensureArrayLength,
	validateBlock,
} from './live-processor-base.js';
import { secondsToSampleFrame as secondsToFrames } from '../timeline-time.ts';

const RMS_WINDOW_SIZE = 100;

export class DynamicsLiveProcessor extends LiveProcessor {
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
		this.scratchFrames = 0;
		this.combinedEnvelope = new Float64Array(this.lookaheadFrames);
		this.transformedEnvelope = new Float64Array(this.lookaheadFrames);
		this.combinedAudio = [];
		this.framesSeen = 0;
		this.resetAnalysis();
	}

	resetAnalysis() {
		this.analysisFrames = 0;
		this.analysisInputPeak = 0;
		this.analysisOutputPeak = 0;
		this.analysisReductionDb = 0;
	}

	/**
	 * Peaks and applied reduction since the previous read.
	 *
	 * Input is measured on the lookahead-delayed sample that produced each output
	 * sample, so the three values describe one moment of the signal rather than
	 * three moments separated by the lookahead window. Reduction excludes makeup
	 * gain: it is what the compression curve took off, which is what Audacity
	 * plots as the actual compression.
	 */
	readAnalysis() {
		if (!this.analysisFrames) return null;
		const analysis = {
			frames: this.analysisFrames,
			inputPeak: this.analysisInputPeak,
			outputPeak: this.analysisOutputPeak,
			reductionDb: this.analysisReductionDb,
		};
		this.resetAnalysis();
		return analysis;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.audioHistory.length !== output.length) {
			this.audioHistory = Array.from({ length: output.length }, () => new Float32Array(this.lookaheadFrames));
			this.envelopeHistory.fill(0);
			this.envelopeState = 0;
			this.framesSeen = 0;
		}
		if (frames > this.scratchFrames) {
			this.scratchFrames = frames;
			this.combinedEnvelope = new Float64Array(this.lookaheadFrames + frames);
			this.transformedEnvelope = new Float64Array(this.lookaheadFrames + frames);
			this.combinedAudio = Array.from({ length: output.length }, () =>
				new Float32Array(this.lookaheadFrames + frames));
		} else {
			ensureArrayLength(this.combinedAudio, output.length, () =>
				new Float32Array(this.lookaheadFrames + this.scratchFrames));
		}
		const combinedEnvelope = this.combinedEnvelope;
		combinedEnvelope.set(this.envelopeHistory);
		const combinedAudio = this.combinedAudio;
		for (let channel = 0; channel < output.length; channel += 1) {
			const values = combinedAudio[channel];
			values.set(this.audioHistory[channel]);
			values.fill(0, this.lookaheadFrames, this.lookaheadFrames + frames);
			const source = channelAt(input, channel);
			if (source) values.set(source, this.lookaheadFrames);
		}
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
		const extent = this.lookaheadFrames + frames;
		const transformed = this.transformedEnvelope;
		transformed.set(combinedEnvelope.subarray(0, extent));
		if (this.lookaheadFrames > 0) {
			applyLookaheadEnvelope(transformed, this.lookaheadFrames, extent);
		}
		let inputPeak = 0;
		let outputPeak = 0;
		for (let channel = 0; channel < output.length; channel += 1) {
			for (let frame = 0; frame < frames; frame += 1) {
				const source = combinedAudio[channel][frame];
				const value = this.framesSeen + frame < this.lookaheadFrames
					? 0
					: source * dbToLinear(transformed[frame] + this.makeupGainDb);
				output[channel][frame] = value;
				const sourceMagnitude = source < 0 ? -source : source;
				if (sourceMagnitude > inputPeak) inputPeak = sourceMagnitude;
				const magnitude = value < 0 ? -value : value;
				if (magnitude > outputPeak) outputPeak = magnitude;
			}
			if (this.lookaheadFrames > 0) {
				this.audioHistory[channel].set(combinedAudio[channel].subarray(
					frames, frames + this.lookaheadFrames,
				));
			}
		}
		if (this.lookaheadFrames > 0) {
			this.envelopeHistory.set(combinedEnvelope.subarray(
				frames, frames + this.lookaheadFrames,
			));
		}
		let reductionDb = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			if (transformed[frame] < reductionDb) reductionDb = transformed[frame];
		}
		this.analysisFrames += frames;
		if (inputPeak > this.analysisInputPeak) this.analysisInputPeak = inputPeak;
		if (outputPeak > this.analysisOutputPeak) this.analysisOutputPeak = outputPeak;
		if (reductionDb < this.analysisReductionDb) this.analysisReductionDb = reductionDb;
		this.framesSeen += frames;
		return true;
	}
}

export class AutoDuckLiveProcessor extends LiveProcessor {
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

function applyLookaheadEnvelope(envelope, lookaheadFrames, length = envelope.length) {
	let nextGainReduction = 0;
	let step = 0;
	for (let index = length - 1; index >= 0; index -= 1) {
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
