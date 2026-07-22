export const EBU_R128_TARGET_LUFS = -23;
export const EBU_R128_TRUE_PEAK_LIMIT_DBTP = -1;
export const EBU_R128_FLOOR_DB = -120;

const ABSOLUTE_GATE_LUFS = -70;
const MOMENTARY_SECONDS = 0.4;
const SHORT_TERM_SECONDS = 3;
const UPDATE_SECONDS = 0.1;
const LRA_UPDATE_SECONDS = 0.1;

// ITU-R BS.1770-5 Annex 2, 48-tap, four-phase interpolating FIR.
const TRUE_PEAK_FIR = Object.freeze([
	Object.freeze([0.0017089843750, -0.0291748046875, -0.0189208984375, -0.0083007812500]),
	Object.freeze([0.0109863281250, 0.0292968750000, 0.0330810546875, 0.0148925781250]),
	Object.freeze([-0.0196533203125, -0.0517578125000, -0.0582275390625, -0.0266113281250]),
	Object.freeze([0.0332031250000, 0.0891113281250, 0.1015625000000, 0.0476074218750]),
	Object.freeze([-0.0594482421875, -0.1665039062500, -0.2003173828125, -0.1022949218750]),
	Object.freeze([0.1373291015625, 0.4650878906250, 0.7797851562500, 0.9721679687500]),
	Object.freeze([0.9721679687500, 0.7797851562500, 0.4650878906250, 0.1373291015625]),
	Object.freeze([-0.1022949218750, -0.2003173828125, -0.1665039062500, -0.0594482421875]),
	Object.freeze([0.0476074218750, 0.1015625000000, 0.0891113281250, 0.0332031250000]),
	Object.freeze([-0.0266113281250, -0.0582275390625, -0.0517578125000, -0.0196533203125]),
	Object.freeze([0.0148925781250, 0.0330810546875, 0.0292968750000, 0.0109863281250]),
	Object.freeze([-0.0083007812500, -0.0189208984375, -0.0291748046875, 0.0017089843750]),
]);

export function ebuEnergyToLufs(energy) {
	return energy > 0 ? -0.691 + 10 * Math.log10(energy) : null;
}

export function ebuAmplitudeToDb(amplitude) {
	return amplitude > 0 ? Math.max(EBU_R128_FLOOR_DB, 20 * Math.log10(amplitude)) : EBU_R128_FLOOR_DB;
}

export function ebuChannelWeights(channelCount) {
	if (channelCount === 5) return [1, 1, 1, Math.SQRT2, Math.SQRT2];
	if (channelCount === 6) return [1, 1, 1, 0, Math.SQRT2, Math.SQRT2];
	return Array.from({ length: channelCount }, () => 1);
}

export function calculateEbuIntegratedLufs(blockEnergies) {
	const absoluteGated = blockEnergies.filter((energy) => {
		const loudness = ebuEnergyToLufs(energy);
		return Number.isFinite(loudness) && loudness > ABSOLUTE_GATE_LUFS;
	});
	if (!absoluteGated.length) return null;
	const relativeGate = ebuEnergyToLufs(average(absoluteGated)) - 10;
	const relativeGated = absoluteGated.filter((energy) => ebuEnergyToLufs(energy) > relativeGate);
	return relativeGated.length ? ebuEnergyToLufs(average(relativeGated)) : null;
}

export function calculateEbuLoudnessRange(shortTermEnergies) {
	const absoluteGated = shortTermEnergies.filter((energy) => {
		const loudness = ebuEnergyToLufs(energy);
		return Number.isFinite(loudness) && loudness > ABSOLUTE_GATE_LUFS;
	});
	if (absoluteGated.length < 2) return null;
	const relativeGate = ebuEnergyToLufs(average(absoluteGated)) - 20;
	const gated = absoluteGated
		.map(ebuEnergyToLufs)
		.filter((loudness) => loudness > relativeGate)
		.sort((first, second) => first - second);
	if (gated.length < 2) return null;
	return percentile(gated, 0.95) - percentile(gated, 0.1);
}

/**
 * Stateful EBU Mode meter. `push` accepts arbitrary equally-sized planar PCM
 * chunks and emits exact 10 Hz snapshots without depending on chunk boundaries.
 */
export function createEbuR128Meter(options = {}) {
	const sampleRate = Number(options.sampleRate);
	const channelCount = Number(options.channelCount ?? 2);
	if (!Number.isInteger(sampleRate) || sampleRate < 8_000) {
		throw new RangeError('A valid EBU R 128 sample rate is required.');
	}
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
		throw new RangeError('EBU R 128 channel count must be from 1 to 8.');
	}
	const weights = options.channelWeights || ebuChannelWeights(channelCount);
	if (weights.length !== channelCount || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
		throw new RangeError('A non-negative loudness weight is required for every channel.');
	}

	const momentaryFrames = Math.max(1, Math.round(sampleRate * MOMENTARY_SECONDS));
	const shortTermFrames = Math.max(momentaryFrames, Math.round(sampleRate * SHORT_TERM_SECONDS));
	const updateFrames = Math.max(1, Math.round(sampleRate * UPDATE_SECONDS));
	const lraUpdateFrames = Math.max(1, Math.round(sampleRate * LRA_UPDATE_SECONDS));
	const filters = Array.from({ length: channelCount }, () => createKWeightingFilter(sampleRate));
	const liveWindow = createEnergyWindow(shortTermFrames, momentaryFrames);
	const programmeWindow = createEnergyWindow(shortTermFrames, momentaryFrames);
	const integratedWindow = createEnergyWindow(momentaryFrames, momentaryFrames);
	const liveTruePeak = Array.from({ length: channelCount }, createTruePeakState);
	const integratedBlocks = [];
	const lraBlocks = [];
	let running = Boolean(options.running);
	let liveFrames = 0;
	let programmeFrames = 0;
	let nextLiveUpdate = updateFrames;
	let nextProgrammeUpdate = updateFrames;
	let nextLraUpdate = shortTermFrames;
	let livePeak = 0;
	let liveSquares = 0;
	let liveSquareSamples = 0;
	let lastLivePeak = 0;
	let lastLiveRms = 0;
	let lastLiveTruePeak = 0;
	let maximumTruePeak = 0;
	let maximumMomentaryLufs = null;
	let maximumShortTermLufs = null;

	function push(channels, onSnapshot, inputGain = 1) {
		validateChannels(channels, channelCount);
		if (!Number.isFinite(inputGain)) throw new RangeError('EBU R 128 input gain must be finite.');
		const applyInputGain = inputGain !== 1;
		const frames = channels[0].length;
		for (let frame = 0; frame < frames; frame += 1) {
			let weightedEnergy = 0;
			let framePeak = 0;
			let frameSquares = 0;
			for (let channel = 0; channel < channelCount; channel += 1) {
				const sourceSample = Number(channels[channel][frame]);
				const sample = applyInputGain ? sourceSample * inputGain : sourceSample;
				if (!Number.isFinite(sample)) throw new RangeError('PCM samples must be finite.');
				framePeak = Math.max(framePeak, Math.abs(sample));
				frameSquares += sample * sample;
				const weighted = filters[channel].process(sample);
				weightedEnergy += weighted * weighted * weights[channel];
				const truePeak = pushTruePeak(liveTruePeak[channel], sample);
				livePeak = Math.max(livePeak, truePeak);
				if (running) maximumTruePeak = Math.max(maximumTruePeak, truePeak);
			}
			livePeak = Math.max(livePeak, framePeak);
			liveSquares += frameSquares;
			liveSquareSamples += channelCount;
			liveWindow.push(weightedEnergy);
			liveFrames += 1;
			if (running) pushProgrammeEnergy(weightedEnergy);
			if (liveFrames >= nextLiveUpdate) {
				nextLiveUpdate += updateFrames;
				lastLivePeak = livePeak;
				lastLiveRms = liveSquareSamples ? Math.sqrt(liveSquares / liveSquareSamples) : 0;
				lastLiveTruePeak = Math.max(livePeak, ...liveTruePeak.map(({ peak }) => peak));
				if (typeof onSnapshot === 'function') onSnapshot(snapshot());
				livePeak = 0;
				liveSquares = 0;
				liveSquareSamples = 0;
				for (const state of liveTruePeak) state.peak = 0;
			}
		}
		return api;
	}

	function pushProgrammeEnergy(energy) {
		programmeWindow.push(energy);
		integratedWindow.push(energy);
		programmeFrames += 1;
		if (programmeFrames >= momentaryFrames
			&& (programmeFrames - momentaryFrames) % updateFrames === 0) {
			integratedBlocks.push(integratedWindow.momentaryEnergy());
		}
		if (programmeFrames >= nextProgrammeUpdate) {
			nextProgrammeUpdate += updateFrames;
			const momentary = programmeFrames >= momentaryFrames
				? ebuEnergyToLufs(programmeWindow.momentaryEnergy())
				: null;
			const shortTerm = programmeFrames >= shortTermFrames
				? ebuEnergyToLufs(programmeWindow.shortTermEnergy())
				: null;
			if (Number.isFinite(momentary)) {
				maximumMomentaryLufs = maximumMomentaryLufs == null
					? momentary
					: Math.max(maximumMomentaryLufs, momentary);
			}
			if (Number.isFinite(shortTerm)) {
				maximumShortTermLufs = maximumShortTermLufs == null
					? shortTerm
					: Math.max(maximumShortTermLufs, shortTerm);
			}
		}
		if (programmeFrames >= nextLraUpdate) {
			nextLraUpdate += lraUpdateFrames;
			lraBlocks.push(programmeWindow.shortTermEnergy());
		}
	}

	function snapshot() {
		const truePeakAmplitude = liveSquareSamples
			? Math.max(livePeak, ...liveTruePeak.map(({ peak }) => peak))
			: lastLiveTruePeak;
		const peak = liveSquareSamples ? livePeak : lastLivePeak;
		const rms = liveSquareSamples ? Math.sqrt(liveSquares / liveSquareSamples) : lastLiveRms;
		return Object.freeze({
			peak,
			rms,
			dbfs: peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY,
			loudness: Object.freeze({
				standard: 'ebu-r128',
				momentaryLufs: liveFrames >= momentaryFrames
					? ebuEnergyToLufs(liveWindow.momentaryEnergy())
					: null,
				shortTermLufs: liveFrames >= shortTermFrames
					? ebuEnergyToLufs(liveWindow.shortTermEnergy())
					: null,
				integratedLufs: calculateEbuIntegratedLufs(integratedBlocks),
				maximumMomentaryLufs,
				maximumShortTermLufs,
				loudnessRangeLu: calculateEbuLoudnessRange(lraBlocks),
				loudnessRangeStable: programmeFrames >= sampleRate * 60,
				truePeakDbtp: ebuAmplitudeToDb(truePeakAmplitude),
				maximumTruePeakDbtp: programmeFrames ? ebuAmplitudeToDb(maximumTruePeak) : null,
				measuredSeconds: programmeFrames / sampleRate,
				state: running ? 'running' : 'standby',
			}),
		});
	}

	function setRunning(value) {
		running = Boolean(value);
		return api;
	}

	function reset() {
		programmeWindow.reset();
		integratedWindow.reset();
		integratedBlocks.length = 0;
		lraBlocks.length = 0;
		programmeFrames = 0;
		nextProgrammeUpdate = updateFrames;
		nextLraUpdate = shortTermFrames;
		maximumTruePeak = 0;
		maximumMomentaryLufs = null;
		maximumShortTermLufs = null;
		return api;
	}

	const api = Object.freeze({
		push,
		reset,
		setRunning,
		snapshot,
		get running() { return running; },
	});
	return api;
}

function createEnergyWindow(capacity, momentaryFrames) {
	const ring = new Float64Array(capacity);
	let writeIndex = 0;
	let size = 0;
	let shortTermSum = 0;
	let momentarySum = 0;
	return Object.freeze({
		push(energy) {
			if (size >= capacity) shortTermSum -= ring[writeIndex];
			if (size >= momentaryFrames) {
				const expired = (writeIndex - momentaryFrames + capacity) % capacity;
				momentarySum -= ring[expired];
			}
			ring[writeIndex] = energy;
			writeIndex = (writeIndex + 1) % capacity;
			size += 1;
			shortTermSum += energy;
			momentarySum += energy;
		},
		momentaryEnergy() {
			return Math.max(0, momentarySum / Math.max(1, Math.min(size, momentaryFrames)));
		},
		shortTermEnergy() {
			return Math.max(0, shortTermSum / Math.max(1, Math.min(size, capacity)));
		},
		reset() {
			ring.fill(0);
			writeIndex = 0;
			size = 0;
			shortTermSum = 0;
			momentarySum = 0;
		},
	});
}

function createKWeightingFilter(sampleRate) {
	const shelf = createBiquadState(createShelfCoefficients(sampleRate));
	const highpass = createBiquadState(createHighpassCoefficients(sampleRate));
	return Object.freeze({
		process(sample) {
			return processBiquad(highpass, processBiquad(shelf, sample));
		},
	});
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

function createTruePeakState() {
	return { history: new Float64Array(TRUE_PEAK_FIR.length), writeIndex: 0, peak: 0 };
}

function pushTruePeak(state, sample) {
	state.history[state.writeIndex] = sample;
	state.writeIndex = (state.writeIndex + 1) % state.history.length;
	let peak = Math.abs(sample);
	for (let phase = 0; phase < 4; phase += 1) {
		let interpolated = 0;
		for (let tap = 0; tap < TRUE_PEAK_FIR.length; tap += 1) {
			const index = (state.writeIndex + tap) % state.history.length;
			interpolated += state.history[index] * TRUE_PEAK_FIR[tap][phase];
		}
		peak = Math.max(peak, Math.abs(interpolated));
	}
	state.peak = Math.max(state.peak, peak);
	return peak;
}

function validateChannels(channels, channelCount) {
	if (!Array.isArray(channels) || channels.length !== channelCount) {
		throw new RangeError(`Expected ${channelCount} PCM channels.`);
	}
	const frames = channels[0]?.length;
	if (!Number.isInteger(frames) || channels.some((channel) => !ArrayBuffer.isView(channel) || channel.length !== frames)) {
		throw new RangeError('PCM channels must be equally sized typed arrays.');
	}
}

function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, fraction) {
	const position = (sortedValues.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sortedValues[lower];
	return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}
