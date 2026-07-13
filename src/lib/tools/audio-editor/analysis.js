export const ANALYSIS_FLOOR_DB = -120;

/**
 * @typedef {Object} AudioAnalysisResult
 * @property {number} sampleRate
 * @property {number} channelCount
 * @property {number} frameCount
 * @property {number} peakDbfs
 * @property {number} truePeakDbtp
 * @property {number} rmsDbfs
 * @property {number | null} stereoCorrelation
 * @property {number | null} momentaryLufs
 * @property {number | null} shortTermLufs
 * @property {number | null} integratedLufs
 * @property {number | null} loudnessRangeLufs
 */

export function amplitudeToDb(amplitude) {
	return amplitude > 0 ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(amplitude)) : ANALYSIS_FLOOR_DB;
}

export function energyToLufs(energy) {
	return energy > 0 ? -0.691 + 10 * Math.log10(energy) : null;
}

/**
 * Creates a bounded-state analyzer. Each `push` accepts one equally-sized typed
 * array per channel; K-weighting, gating windows, correlation, and true-peak
 * interpolation remain continuous across arbitrary chunk boundaries.
 *
 * @returns {{push: (channels: Array<ArrayBufferView>) => *, finish: () => AudioAnalysisResult}}
 */
export function createStreamingAudioAnalyzer(options = {}) {
	const sampleRate = Number(options.sampleRate);
	const channelCount = Number(options.channelCount ?? 2);
	if (!Number.isInteger(sampleRate) || sampleRate < 8_000) throw new RangeError('A valid analysis sample rate is required.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
		throw new RangeError('Analysis channel count must be from 1 to 8.');
	}
	const oversample = Number(options.truePeakOversample ?? 4);
	if (![1, 2, 4, 8].includes(oversample)) throw new RangeError('True-peak oversampling must be 1, 2, 4, or 8.');
	const clipThreshold = Number(options.clipThreshold ?? 1);
	if (!Number.isFinite(clipThreshold) || clipThreshold <= 0) throw new RangeError('Clip threshold must be positive.');
	const channelWeights = options.channelWeights || Array.from({ length: channelCount }, () => 1);
	if (channelWeights.length !== channelCount || channelWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
		throw new RangeError('A non-negative loudness weight is required for every channel.');
	}

	const kWeighting = Array.from({ length: channelCount }, () => createKWeightingFilter(sampleRate));
	const samplePeaks = new Float64Array(channelCount);
	const truePeakStates = Array.from({ length: channelCount }, () => ({ history: [], started: false, peak: 0 }));
	const momentaryFrames = Math.max(1, Math.round(sampleRate * 0.4));
	const momentaryStep = Math.max(1, Math.round(sampleRate * 0.1));
	const shortTermFrames = Math.max(momentaryFrames, Math.round(sampleRate * 3));
	const shortTermStep = Math.max(1, Math.round(sampleRate));
	const energyRing = new Float64Array(shortTermFrames);
	const momentaryEnergies = [];
	const shortTermEnergies = [];
	let energyWriteIndex = 0;
	let momentaryEnergySum = 0;
	let shortTermEnergySum = 0;
	let frameCount = 0;
	let sampleSquareSum = 0;
	let clippedSamples = 0;
	let clippedFrames = 0;
	let leftSum = 0;
	let rightSum = 0;
	let leftSquareSum = 0;
	let rightSquareSum = 0;
	let crossSum = 0;
	let result = null;

	function push(channels) {
		if (result) throw new Error('Cannot add PCM after analysis has finished.');
		if (!Array.isArray(channels) || channels.length !== channelCount) {
			throw new RangeError(`Expected ${channelCount} PCM channels.`);
		}
		const frames = channels[0]?.length;
		if (!Number.isInteger(frames)) throw new TypeError('PCM channels must be typed arrays.');
		if (channels.some((channel) => !ArrayBuffer.isView(channel) || channel.length !== frames)) {
			throw new RangeError('PCM channels must be equally sized typed arrays.');
		}

		for (let frame = 0; frame < frames; frame += 1) {
			let weightedEnergy = 0;
			let frameClipped = false;
			for (let channel = 0; channel < channelCount; channel += 1) {
				const sample = Number(channels[channel][frame]);
				if (!Number.isFinite(sample)) throw new RangeError('PCM samples must be finite.');
				const absolute = Math.abs(sample);
				samplePeaks[channel] = Math.max(samplePeaks[channel], absolute);
				sampleSquareSum += sample * sample;
				if (absolute >= clipThreshold) {
					clippedSamples += 1;
					frameClipped = true;
				}
				pushTruePeakSample(truePeakStates[channel], sample, oversample);
				const weighted = kWeighting[channel].process(sample);
				weightedEnergy += weighted * weighted * channelWeights[channel];
			}
			if (frameClipped) clippedFrames += 1;
			if (channelCount >= 2) {
				const left = Number(channels[0][frame]);
				const right = Number(channels[1][frame]);
				leftSum += left;
				rightSum += right;
				leftSquareSum += left * left;
				rightSquareSum += right * right;
				crossSum += left * right;
			}
			pushLoudnessEnergy(weightedEnergy);
			frameCount += 1;
		}
		return api;
	}

	function pushLoudnessEnergy(energy) {
		if (frameCount >= shortTermFrames) shortTermEnergySum -= energyRing[energyWriteIndex];
		if (frameCount >= momentaryFrames) {
			const expiredIndex = (energyWriteIndex - momentaryFrames + shortTermFrames) % shortTermFrames;
			momentaryEnergySum -= energyRing[expiredIndex];
		}
		energyRing[energyWriteIndex] = energy;
		energyWriteIndex = (energyWriteIndex + 1) % shortTermFrames;
		momentaryEnergySum += energy;
		shortTermEnergySum += energy;
		const nextFrameCount = frameCount + 1;
		if (nextFrameCount >= momentaryFrames && (nextFrameCount - momentaryFrames) % momentaryStep === 0) {
			momentaryEnergies.push(Math.max(0, momentaryEnergySum / momentaryFrames));
		}
		if (nextFrameCount >= shortTermFrames && (nextFrameCount - shortTermFrames) % shortTermStep === 0) {
			shortTermEnergies.push(Math.max(0, shortTermEnergySum / shortTermFrames));
		}
	}

	function finish() {
		if (result) return result;
		const truePeaks = truePeakStates.map((state) => finishTruePeak(state, oversample));
		const peakAmplitude = Math.max(0, ...samplePeaks);
		const truePeakAmplitude = Math.max(peakAmplitude, ...truePeaks);
		const integratedLufs = calculateIntegratedLufs(momentaryEnergies);
		const momentaryValues = momentaryEnergies.map(energyToLufs).filter(Number.isFinite);
		const shortTermValues = shortTermEnergies.map(energyToLufs).filter(Number.isFinite);
		result = Object.freeze({
			sampleRate,
			channelCount,
			frameCount,
			durationSeconds: frameCount / sampleRate,
			peakAmplitude,
			peakDbfs: amplitudeToDb(peakAmplitude),
			channelPeakDbfs: Array.from(samplePeaks, amplitudeToDb),
			truePeakAmplitude,
			truePeakDbtp: amplitudeToDb(truePeakAmplitude),
			truePeakOversample: oversample,
			truePeakEstimated: true,
			rmsAmplitude: frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0,
			rmsDbfs: amplitudeToDb(frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0),
			clippedSamples,
			clippedFrames,
			stereoCorrelation: calculateCorrelation(),
			momentaryLufs: last(momentaryValues),
			maxMomentaryLufs: maximum(momentaryValues),
			shortTermLufs: last(shortTermValues),
			maxShortTermLufs: maximum(shortTermValues),
			integratedLufs,
			loudnessRangeLufs: calculateLoudnessRange(shortTermEnergies, integratedLufs),
			momentaryBlockCount: momentaryEnergies.length,
			shortTermBlockCount: shortTermEnergies.length,
		});
		return result;
	}

	function calculateCorrelation() {
		if (channelCount < 2 || frameCount < 2) return null;
		const covariance = crossSum - leftSum * rightSum / frameCount;
		const leftVariance = leftSquareSum - leftSum * leftSum / frameCount;
		const rightVariance = rightSquareSum - rightSum * rightSum / frameCount;
		const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
		return denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
	}

	const api = Object.freeze({ push, finish });
	return api;
}

/** @returns {AudioAnalysisResult} */
export function analyzeAudioChannels(channels, sampleRate, options = {}) {
	return createStreamingAudioAnalyzer({ ...options, sampleRate, channelCount: channels.length })
		.push(channels)
		.finish();
}

/** Audacity-style Find Clipping report with linked-channel frame regions. */
export function findAudioClippingRegions(channels, options = {}) {
	validateAnalysisChannels(channels);
	const threshold = Number(options.threshold ?? 1);
	const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
	if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError('Clipping threshold must be positive.');
	if (!Number.isSafeInteger(minimumConsecutiveSamples) || minimumConsecutiveSamples <= 0) {
		throw new RangeError('Minimum consecutive clipping samples must be positive.');
	}
	const regions = [];
	let startFrame = null;
	let peakAmplitude = 0;
	let clippedSamples = 0;
	for (let frame = 0; frame <= channels[0].length; frame += 1) {
		let framePeak = 0;
		let frameClippedSamples = 0;
		if (frame < channels[0].length) {
			for (const channel of channels) {
				const amplitude = Math.abs(channel[frame]);
				framePeak = Math.max(framePeak, amplitude);
				if (amplitude >= threshold) frameClippedSamples += 1;
			}
		}
		if (frameClippedSamples) {
			if (startFrame == null) startFrame = frame;
			peakAmplitude = Math.max(peakAmplitude, framePeak);
			clippedSamples += frameClippedSamples;
			continue;
		}
		if (startFrame == null) continue;
		const endFrame = frame;
		if (endFrame - startFrame >= minimumConsecutiveSamples) {
			regions.push(Object.freeze({ startFrame, endFrame, frameCount: endFrame - startFrame, clippedSamples, peakAmplitude }));
		}
		startFrame = null;
		peakAmplitude = 0;
		clippedSamples = 0;
	}
	return Object.freeze(regions);
}

/** Audacity Contrast report comparing foreground and background RMS levels. */
export function analyzeAudioContrast(foregroundChannels, backgroundChannels, options = {}) {
	validateAnalysisChannels(foregroundChannels);
	validateAnalysisChannels(backgroundChannels);
	const minimumDifferenceDb = Number(options.minimumDifferenceDb ?? 20);
	if (!Number.isFinite(minimumDifferenceDb) || minimumDifferenceDb < 0) throw new RangeError('Minimum contrast must be non-negative.');
	const foregroundRmsDb = rmsDb(foregroundChannels);
	const backgroundRmsDb = rmsDb(backgroundChannels);
	const differenceDb = foregroundRmsDb - backgroundRmsDb;
	return Object.freeze({
		foregroundRmsDb,
		backgroundRmsDb,
		differenceDb,
		minimumDifferenceDb,
		passes: differenceDb >= minimumDifferenceDb,
	});
}

/** Windowed radix-2 spectrum for Plot Spectrum and spectral panels. */
export function calculateAudioSpectrum(channels, sampleRate, options = {}) {
	validateAnalysisChannels(channels);
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Spectrum sample rate must be positive.');
	const requestedSize = Number(options.size ?? 2_048);
	if (!Number.isSafeInteger(requestedSize) || requestedSize < 32 || requestedSize > 65_536 || (requestedSize & (requestedSize - 1))) {
		throw new RangeError('Spectrum size must be a power of two from 32 through 65536.');
	}
	const offset = Math.max(0, Math.min(channels[0].length, Number(options.offsetFrame) || 0));
	const real = new Float64Array(requestedSize);
	const imaginary = new Float64Array(requestedSize);
	for (let index = 0; index < requestedSize; index += 1) {
		const frame = offset + index;
		let sample = 0;
		if (frame < channels[0].length) for (const channel of channels) sample += channel[frame] / channels.length;
		const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (requestedSize - 1));
		real[index] = sample * window;
	}
	fftInPlace(real, imaginary);
	const bins = Array.from({ length: requestedSize / 2 + 1 }, (_, index) => {
		const amplitude = Math.hypot(real[index], imaginary[index]) * 2 / requestedSize;
		return Object.freeze({
			frequency: index * sampleRate / requestedSize,
			amplitude,
			db: amplitudeToDb(amplitude),
		});
	});
	return Object.freeze({ sampleRate, size: requestedSize, bins: Object.freeze(bins) });
}

/**
 * Find the nearest linked-channel zero crossing. Exact zero samples and sign
 * changes are preferred by distance, then by the lowest summed amplitude.
 * If a window has no crossing, its quietest frame is returned.
 */
export function findNearestAudioZeroCrossing(channels, targetFrame, options = {}) {
	validateAnalysisChannels(channels);
	if (!channels[0].length) return 0;
	const target = Math.max(0, Math.min(channels[0].length - 1, Math.round(Number(targetFrame) || 0)));
	const maximumDistance = Math.max(0, Math.min(
		channels[0].length - 1,
		Number.isSafeInteger(Number(options.maximumDistance))
			? Number(options.maximumDistance)
			: channels[0].length - 1,
	));
	let quietestFrame = target;
	let quietestScore = linkedAmplitude(channels, target);
	for (let distance = 0; distance <= maximumDistance; distance += 1) {
		const candidates = distance === 0 ? [target] : [target - distance, target + distance];
		let crossing = null;
		let crossingScore = Infinity;
		for (const frame of candidates) {
			if (frame < 0 || frame >= channels[0].length) continue;
			const score = linkedAmplitude(channels, frame);
			if (score < quietestScore) {
				quietestFrame = frame;
				quietestScore = score;
			}
			if (isLinkedZeroCrossing(channels, frame) && score < crossingScore) {
				crossing = frame;
				crossingScore = score;
			}
		}
		if (crossing != null) return crossing;
	}
	return quietestFrame;
}

function isLinkedZeroCrossing(channels, frame) {
	for (const channel of channels) {
		const current = Number(channel[frame]) || 0;
		if (current === 0) return true;
		if (frame > 0) {
			const previous = Number(channel[frame - 1]) || 0;
			if (previous === 0 || (previous < 0 && current > 0) || (previous > 0 && current < 0)) return true;
		}
	}
	return false;
}

function linkedAmplitude(channels, frame) {
	let amplitude = 0;
	for (const channel of channels) amplitude += Math.abs(Number(channel[frame]) || 0);
	return amplitude;
}

function fftInPlace(real, imaginary) {
	const length = real.length;
	for (let index = 1, reversed = 0; index < length; index += 1) {
		let bit = length >> 1;
		while (reversed & bit) { reversed ^= bit; bit >>= 1; }
		reversed ^= bit;
		if (index >= reversed) continue;
		[real[index], real[reversed]] = [real[reversed], real[index]];
		[imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
	}
	for (let size = 2; size <= length; size <<= 1) {
		const angle = -2 * Math.PI / size;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < length; start += size) {
			let weightReal = 1;
			let weightImaginary = 0;
			for (let index = 0; index < size / 2; index += 1) {
				const even = start + index;
				const odd = even + size / 2;
				const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary;
				const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal;
				real[odd] = real[even] - oddReal;
				imaginary[odd] = imaginary[even] - oddImaginary;
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextWeightReal = weightReal * stepReal - weightImaginary * stepImaginary;
				weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
				weightReal = nextWeightReal;
			}
		}
	}
}

function validateAnalysisChannels(channels) {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	if (channels.some((channel) => channel.length !== channels[0].length)) throw new RangeError('Audio channels must have equal lengths.');
}

function rmsDb(channels) {
	let squares = 0;
	let count = 0;
	for (const channel of channels) for (const sample of channel) { squares += sample * sample; count += 1; }
	return amplitudeToDb(count ? Math.sqrt(squares / count) : 0);
}

export function calculateIntegratedLufs(blockEnergies) {
	const absoluteGated = blockEnergies.filter((energy) => {
		const loudness = energyToLufs(energy);
		return loudness != null && loudness >= -70;
	});
	if (!absoluteGated.length) return null;
	const preliminaryEnergy = average(absoluteGated);
	const relativeGate = energyToLufs(preliminaryEnergy) - 10;
	const relativeGated = absoluteGated.filter((energy) => energyToLufs(energy) >= relativeGate);
	return energyToLufs(average(relativeGated));
}

export function calculateLoudnessRange(shortTermEnergies, integratedLufs) {
	if (!Number.isFinite(integratedLufs)) return null;
	const absoluteGated = shortTermEnergies.filter((energy) => {
		const loudness = energyToLufs(energy);
		return Number.isFinite(loudness) && loudness >= -70;
	});
	if (absoluteGated.length < 2) return null;
	const relativeGate = energyToLufs(average(absoluteGated)) - 20;
	const gated = absoluteGated
		.map(energyToLufs)
		.filter((loudness) => loudness >= relativeGate)
		.sort((first, second) => first - second);
	if (gated.length < 2) return null;
	return percentile(gated, 0.95) - percentile(gated, 0.1);
}

function createKWeightingFilter(sampleRate) {
	const shelf = createShelfCoefficients(sampleRate);
	const highpass = createHighpassCoefficients(sampleRate);
	const shelfState = createBiquadState(shelf);
	const highpassState = createBiquadState(highpass);
	return {
		process(sample) {
			return processBiquad(highpassState, processBiquad(shelfState, sample));
		},
	};
}

function createShelfCoefficients(sampleRate) {
	const frequency = 1_681.974450955533;
	const gain = 3.999843853973347;
	const q = 0.7071752369554196;
	const vh = 10 ** (gain / 20);
	const vb = vh ** 0.4996667741545416;
	const k = Math.tan(Math.PI * frequency / sampleRate);
	const a0 = 1 + k / q + k * k;
	return {
		b0: (vh + vb * k / q + k * k) / a0,
		b1: 2 * (k * k - vh) / a0,
		b2: (vh - vb * k / q + k * k) / a0,
		a1: 2 * (k * k - 1) / a0,
		a2: (1 - k / q + k * k) / a0,
	};
}

function createHighpassCoefficients(sampleRate) {
	const frequency = 38.13547087602444;
	const q = 0.5003270373238773;
	const k = Math.tan(Math.PI * frequency / sampleRate);
	const a0 = 1 + k / q + k * k;
	return {
		b0: 1 / a0,
		b1: -2 / a0,
		b2: 1 / a0,
		a1: 2 * (k * k - 1) / a0,
		a2: (1 - k / q + k * k) / a0,
	};
}

function createBiquadState(coefficients) {
	return { ...coefficients, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(state, x0) {
	const y0 = state.b0 * x0 + state.b1 * state.x1 + state.b2 * state.x2
		- state.a1 * state.y1 - state.a2 * state.y2;
	state.x2 = state.x1;
	state.x1 = x0;
	state.y2 = state.y1;
	state.y1 = y0;
	return y0;
}

function pushTruePeakSample(state, sample, oversample) {
	state.peak = Math.max(state.peak, Math.abs(sample));
	if (oversample === 1) return;
	state.history.push(sample);
	if (!state.started && state.history.length === 3) {
		interpolatePeak(state, state.history[0], state.history[0], state.history[1], state.history[2], oversample);
		state.started = true;
	}
	if (state.history.length === 4) {
		interpolatePeak(state, state.history[0], state.history[1], state.history[2], state.history[3], oversample);
		state.history.shift();
	}
}

function finishTruePeak(state, oversample) {
	if (oversample === 1 || state.history.length < 2) return state.peak;
	const history = state.history;
	if (!state.started) {
		interpolatePeak(state, history[0], history[0], history[1], history[1], oversample);
	} else {
		interpolatePeak(state, history[0], history[1], history[2], history[2], oversample);
	}
	return state.peak;
}

function interpolatePeak(state, p0, p1, p2, p3, oversample) {
	for (let phase = 1; phase < oversample; phase += 1) {
		const t = phase / oversample;
		const t2 = t * t;
		const t3 = t2 * t;
		const sample = 0.5 * ((2 * p1)
			+ (-p0 + p2) * t
			+ (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
			+ (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
		state.peak = Math.max(state.peak, Math.abs(sample));
	}
}

function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function last(values) {
	return values.length ? values[values.length - 1] : null;
}

function maximum(values) {
	return values.length ? Math.max(...values) : null;
}

function percentile(sortedValues, fraction) {
	const position = (sortedValues.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sortedValues[lower];
	return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}
