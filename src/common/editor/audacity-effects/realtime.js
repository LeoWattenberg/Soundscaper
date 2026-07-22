/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * JavaScript DSP adaptations of Audacity 3.7.7 built-in effects, commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b, from:
 *
 * - libraries/lib-builtin-effects/BassTrebleBase.cpp — Steve Daulton
 * - libraries/lib-builtin-effects/DistortionBase.cpp — Steve Daulton
 * - libraries/lib-builtin-effects/EchoBase.cpp — Dominic Mazzoni and
 *   Vaughan Johnson
 * - libraries/lib-builtin-effects/PhaserBase.cpp — Nasca Octavian Paul
 * - libraries/lib-builtin-effects/ScienFilterBase.cpp — Norm C, Mitch Golden,
 *   and Vaughan Johnson
 * - libraries/lib-builtin-effects/WahWahBase.cpp — Nasca Octavian Paul
 *
 * Audacity is distributed under GPL version 3; individual source files are
 * GPL-2.0-or-later where noted upstream. This modified JavaScript adaptation
 * was created for kw.media in 2026 and selects GPL version 3.
 */

const DISTORTION_STEPS = 1024;
const DISTORTION_TABLE_SIZE = DISTORTION_STEPS * 2 + 1;
const PHASER_LFO_SHAPE = 4;
const FLOAT_MAX = 3.4028234663852886e38;

export const AUDACITY_DISTORTION_MODES = Object.freeze([
	'hard-clipping',
	'soft-clipping',
	'soft-overdrive',
	'medium-overdrive',
	'hard-overdrive',
	'cubic',
	'even-harmonics',
	'expand-compress',
	'leveller',
	'rectifier',
	'hard-limiter',
]);

export const AUDACITY_CLASSIC_FILTER_FAMILIES = Object.freeze([
	'butterworth',
	'chebyshev-i',
	'chebyshev-ii',
]);

/**
 * Audacity's fixed 250 Hz low shelf followed by its fixed 4 kHz high shelf.
 */
export function applyAudacityBassTreble(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const bassDb = numberParam(params, 'bassDb', 0, -30, 30, ['bass']);
	const trebleDb = numberParam(params, 'trebleDb', 0, -30, 30, ['treble']);
	const volumeDb = numberParam(params, 'volumeDb', 0, -30, 30, ['gain']);

	// Link volume is an Audacity UI convenience; it does not alter the DSP once
	// the three gain values have been resolved.
	if (bassDb === 0 && trebleDb === 0 && volumeDb === 0) return cloneChannels(channels);

	// The upstream state stores the fixed slope as float before coefficient
	// calculation, so retain that rounding here.
	const shelfSlope = Math.fround(0.4);
	const bass = shelfCoefficients(250, shelfSlope, bassDb, sampleRate, false);
	const treble = shelfCoefficients(4_000, shelfSlope, trebleDb, sampleRate, true);
	const outputGain = dbToLinear(volumeDb);

	return channels.map((input) => {
		const output = new Float32Array(input.length);
		const bassState = [0, 0, 0, 0];
		const trebleState = [0, 0, 0, 0];
		for (let index = 0; index < input.length; index += 1) {
			const lowShelved = processShelf(input[index], bass, bassState);
			const highShelved = processShelf(lowShelved, treble, trebleState);
			output[index] = highShelved * outputGain;
		}
		return output;
	});
}

/**
 * Audacity's eleven lookup-table waveshapers, including its optional rolling
 * average DC blocker.
 */
export function applyAudacityDistortion(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = {
		mode: enumParam(params.mode, AUDACITY_DISTORTION_MODES, 'hard-clipping', 'mode'),
		dcBlock: Boolean(params.dcBlock ?? false),
		thresholdDb: numberParam(params, 'thresholdDb', -6, -100, 0),
		noiseFloorDb: numberParam(params, 'noiseFloorDb', -70, -80, -20),
		parameter1: numberParam(params, 'parameter1', 50, 0, 100, ['param1']),
		parameter2: numberParam(params, 'parameter2', 50, 0, 100, ['param2']),
		repeats: integerParam(params, 'repeats', 1, 0, 5),
	};
	const { table, makeupGain } = makeDistortionTable(settings);
	const modeIndex = AUDACITY_DISTORTION_MODES.indexOf(settings.mode);
	const p1 = settings.parameter1 / 100;
	const p2 = settings.parameter2 / 100;
	const dcWindow = Math.max(1, Math.floor(sampleRate / 20));

	return channels.map((input) => {
		const output = new Float32Array(input.length);
		const dcState = settings.dcBlock ? createDcState(dcWindow) : null;
		for (let index = 0; index < input.length; index += 1) {
			const shaped = distortionWaveShaper(input[index], table, modeIndex, settings.parameter1);
			let sample;
			switch (modeIndex) {
				case 0:
				case 1:
					sample = shaped * ((1 - p2) + makeupGain * p2);
					break;
				case 2:
				case 3:
				case 4:
				case 5:
				case 7:
					sample = shaped * p2;
					break;
				case 10:
					sample = shaped * (p1 - p2) + input[index] * p2;
					break;
				default:
					sample = shaped;
			}
			sample = Math.fround(sample);
			output[index] = dcState ? dcFilter(sample, dcState) : sample;
		}
		return output;
	});
}

/** Audacity's recursive, selection-length echo (no generated tail). */
export function applyAudacityEcho(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const delaySeconds = numberParam(params, 'delaySeconds', 1, 0.001, FLOAT_MAX, ['delay']);
	const decay = numberParam(params, 'decay', 0.5, 0, FLOAT_MAX);
	const historyLength = Math.floor(sampleRate * delaySeconds);
	if (historyLength < 1) throw new RangeError('delaySeconds must span at least one sample.');

	return channels.map((input, channelIndex) => {
		const output = new Float32Array(input.length);
		const history = new Float32Array(historyLength);
		let historyPosition = 0;
		for (let index = 0; index < input.length; index += 1) {
			const sample = input[index] + history[historyPosition] * decay;
			output[index] = sample;
			if (!Number.isFinite(output[index])) {
				throw new RangeError(
					`Echo produced a non-finite sample at channel ${channelIndex}, frame ${index}; reduce Decay.`,
				);
			}
			history[historyPosition] = output[index];
			historyPosition += 1;
			if (historyPosition === historyLength) historyPosition = 0;
		}
		return output;
	});
}

/** Audacity's cascaded all-pass phaser with a sample-and-hold LFO. */
export function applyAudacityPhaser(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const rawStages = integerParam(params, 'stages', 2, 2, 24);
	const settings = {
		stages: rawStages & ~1,
		dryWet: integerParam(params, 'dryWet', 128, 0, 255),
		frequency: numberParam(params, 'frequency', 0.4, 0.001, 4, ['freq']),
		phaseDegrees: numberParam(params, 'phaseDegrees', 0, 0, 360, ['phase']),
		depth: integerParam(params, 'depth', 100, 0, 255),
		feedbackPercent: integerParam(params, 'feedbackPercent', 0, -100, 100, ['feedback']),
		outputGainDb: numberParam(params, 'outputGainDb', -6, -30, 30, ['gain']),
	};
	const lfoStep = settings.frequency * 2 * Math.PI / sampleRate;
	const phase = settings.phaseDegrees * Math.PI / 180;
	const outputGain = dbToLinear(settings.outputGainDb);

	return channels.map((input) => {
		const output = new Float32Array(input.length);
		const old = new Float64Array(settings.stages);
		let skipCount = 0;
		let allPassGain = 0;
		let feedbackOutput = 0;
		for (let index = 0; index < input.length; index += 1) {
			const dry = input[index];
			let sample = dry + feedbackOutput * settings.feedbackPercent / 101;
			const updateLfo = skipCount % 20 === 0;
			skipCount += 1;
			if (updateLfo) {
				allPassGain = (1 + Math.cos(skipCount * lfoStep + phase)) / 2;
				allPassGain = Math.expm1(allPassGain * PHASER_LFO_SHAPE) / Math.expm1(PHASER_LFO_SHAPE);
				allPassGain = 1 - allPassGain / 255 * settings.depth;
			}
			for (let stage = 0; stage < settings.stages; stage += 1) {
				const previous = old[stage];
				old[stage] = allPassGain * previous + sample;
				sample = previous - allPassGain * old[stage];
			}
			feedbackOutput = sample;
			output[index] = outputGain * (
				sample * settings.dryWet + dry * (255 - settings.dryWet)
			) / 255;
		}
		return output;
	});
}

/** Audacity's Butterworth and Chebyshev I/II classic IIR filters. */
export function applyAudacityClassicFilter(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = {
		family: enumParam(params.family ?? params.type, AUDACITY_CLASSIC_FILTER_FAMILIES, 'butterworth', 'family'),
		direction: enumParam(params.direction ?? params.subtype, ['lowpass', 'highpass'], 'lowpass', 'direction'),
		order: integerParam(params, 'order', 1, 1, 10),
		cutoffHz: numberParam(params, 'cutoffHz', 1_000, 1, 23_999, ['cutoff']),
		passbandRippleDb: numberParam(params, 'passbandRippleDb', 1, 0, 100, ['passbandRipple']),
		stopbandAttenuationDb: numberParam(params, 'stopbandAttenuationDb', 30, 0, 100, ['stopbandRipple']),
	};
	const coefficients = classicFilterCoefficients(settings, sampleRate / 2);

	return channels.map((input) => {
		const output = new Float32Array(input.length);
		let stageInput = input;
		for (const coefficient of coefficients) {
			let previousInput = 0;
			let previousPreviousInput = 0;
			let previousOutput = 0;
			let previousPreviousOutput = 0;
			for (let index = 0; index < input.length; index += 1) {
				const currentInput = stageInput[index];
				const currentOutput = currentInput * coefficient.b0
					+ previousInput * coefficient.b1
					+ previousPreviousInput * coefficient.b2
					- previousOutput * coefficient.a1
					- previousPreviousOutput * coefficient.a2;
				previousPreviousInput = previousInput;
				previousInput = currentInput;
				previousPreviousOutput = previousOutput;
				previousOutput = currentOutput;
				output[index] = currentOutput;
			}
			stageInput = output;
		}
		return output;
	});
}

/** Audacity's resonant, LFO-controlled wah filter. */
export function applyAudacityWahwah(channels, sampleRate, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = {
		frequency: numberParam(params, 'frequency', 1.5, 0.1, 4, ['freq']),
		phaseDegrees: numberParam(params, 'phaseDegrees', 0, 0, 360, ['phase']),
		depthPercent: integerParam(params, 'depthPercent', 70, 0, 100, ['depth']),
		resonance: numberParam(params, 'resonance', 2.5, 0.1, 10),
		frequencyOffsetPercent: integerParam(params, 'frequencyOffsetPercent', 30, 0, 100, ['offset']),
		outputGainDb: numberParam(params, 'outputGainDb', -6, -30, 30, ['gain']),
	};
	const lfoStep = settings.frequency * 2 * Math.PI / sampleRate;
	const phase = settings.phaseDegrees * Math.PI / 180;
	const depth = settings.depthPercent / 100;
	const frequencyOffset = settings.frequencyOffsetPercent / 100;
	const outputGain = dbToLinear(settings.outputGainDb);

	return channels.map((input) => {
		const output = new Float32Array(input.length);
		let skipCount = 0;
		let previousInput = 0;
		let previousPreviousInput = 0;
		let previousOutput = 0;
		let previousPreviousOutput = 0;
		let b0 = 0;
		let b1 = 0;
		let b2 = 0;
		let a0 = 0;
		let a1 = 0;
		let a2 = 0;

		for (let index = 0; index < input.length; index += 1) {
			const updateLfo = skipCount % 30 === 0;
			skipCount += 1;
			if (updateLfo) {
				let center = (1 + Math.cos(skipCount * lfoStep + phase)) / 2;
				center = center * depth * (1 - frequencyOffset) + frequencyOffset;
				center = Math.exp((center - 1) * 6);
				const omega = Math.PI * center;
				const sine = Math.sin(omega);
				const cosine = Math.cos(omega);
				const alpha = sine / (2 * settings.resonance);
				b0 = (1 - cosine) / 2;
				b1 = 1 - cosine;
				b2 = b0;
				a0 = 1 + alpha;
				a1 = -2 * cosine;
				a2 = 1 - alpha;
			}

			const currentInput = input[index];
			const currentOutput = (b0 * currentInput
				+ b1 * previousInput
				+ b2 * previousPreviousInput
				- a1 * previousOutput
				- a2 * previousPreviousOutput) / a0;
			previousPreviousInput = previousInput;
			previousInput = currentInput;
			previousPreviousOutput = previousOutput;
			previousOutput = currentOutput;
			output[index] = currentOutput * outputGain;
		}
		return output;
	});
}

function validateAudio(channels, sampleRate) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('channels must be a non-empty array of Float32Array values.');
	}
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('sampleRate must be a positive finite number.');
	}
	const length = channels[0] instanceof Float32Array ? channels[0].length : -1;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) throw new TypeError('Every channel must be a Float32Array.');
		if (channel.length !== length) throw new RangeError('All channels must have the same length.');
	}
}

function cloneChannels(channels) {
	return channels.map((channel) => new Float32Array(channel));
}

function numberParam(params, name, fallback, minimum, maximum, aliases = []) {
	let value = params[name];
	if (value === undefined) {
		for (const alias of aliases) {
			if (params[alias] !== undefined) {
				value = params[alias];
				break;
			}
		}
	}
	const number = Number(value ?? fallback);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function integerParam(params, name, fallback, minimum, maximum, aliases = []) {
	const value = numberParam(params, name, fallback, minimum, maximum, aliases);
	if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer.`);
	return value;
}

function enumParam(value, values, fallback, name) {
	const resolved = value ?? fallback;
	if (Number.isInteger(resolved) && resolved >= 0 && resolved < values.length) return values[resolved];
	if (!values.includes(resolved)) throw new RangeError(`${name} must be one of: ${values.join(', ')}.`);
	return resolved;
}

function dbToLinear(db) {
	return Math.exp(Math.log(10) * db / 20);
}

function shelfCoefficients(frequency, slope, gainDb, sampleRate, highShelf) {
	const omega = 2 * Math.PI * frequency / sampleRate;
	const amplitude = Math.exp(Math.log(10) * gainDb / 40);
	const beta = Math.sqrt((amplitude * amplitude + 1) / slope - (amplitude - 1) ** 2);
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (!highShelf) {
		return {
			b0: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta * sine),
			b1: 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
			b2: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta * sine),
			a0: (amplitude + 1) + (amplitude - 1) * cosine + beta * sine,
			a1: -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
			a2: (amplitude + 1) + (amplitude - 1) * cosine - beta * sine,
		};
	}
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
	const output = Math.fround((coefficient.b0 * input
		+ coefficient.b1 * state[0]
		+ coefficient.b2 * state[1]
		- coefficient.a1 * state[2]
		- coefficient.a2 * state[3]) / coefficient.a0);
	state[1] = state[0];
	state[0] = input;
	state[3] = state[2];
	state[2] = output;
	return output;
}

function makeDistortionTable(settings) {
	const table = new Float64Array(DISTORTION_TABLE_SIZE);
	const mode = AUDACITY_DISTORTION_MODES.indexOf(settings.mode);
	let makeupGain = 1;
	const copyPositiveHalf = () => {
		let source = DISTORTION_TABLE_SIZE - 1;
		for (let index = 0; index < DISTORTION_STEPS; index += 1) {
			table[index] = -table[source];
			source -= 1;
		}
	};

	if (mode === 0 || mode === 10) {
		const threshold = dbToLinear(settings.thresholdDb);
		const lowThreshold = 1 - threshold;
		const highThreshold = 1 + threshold;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			if (index < DISTORTION_STEPS * lowThreshold) table[index] = -threshold;
			else if (index > DISTORTION_STEPS * highThreshold) table[index] = threshold;
			else table[index] = index / DISTORTION_STEPS - 1;
		}
		makeupGain = 1 / threshold;
	} else if (mode === 1) {
		const threshold = dbToLinear(settings.thresholdDb);
		const tableThreshold = 1 + threshold;
		const amount = 2 ** (7 * settings.parameter1 / 100);
		const logCurve = (value) => Math.fround(
			threshold + (Math.exp(amount * (threshold - value)) - 1) / -amount,
		);
		makeupGain = 1 / logCurve(1);
		table[DISTORTION_STEPS] = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			const value = index / DISTORTION_STEPS - 1;
			table[index] = index < DISTORTION_STEPS * tableThreshold ? value : logCurve(value);
		}
		copyPositiveHalf();
	} else if (mode === 2) {
		const iterations = Math.floor(settings.parameter1 / 20);
		const fraction = settings.parameter1 / 20 - iterations;
		let linearValue = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			let value = linearValue;
			for (let iteration = 0; iteration < iterations; iteration += 1) value = Math.sin(value * Math.PI / 2);
			value += (Math.sin(value * Math.PI / 2) - value) * fraction;
			table[index] = value;
			linearValue += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 3) {
		const amount = Math.min(0.999, dbToLinear(-settings.parameter1));
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			const linearValue = index / DISTORTION_STEPS;
			const scale = -1 / (1 - amount);
			const curve = Math.exp((linearValue - 1) * Math.log(amount));
			table[index] = scale * (curve - 1);
		}
		copyPositiveHalf();
	} else if (mode === 4) {
		let linearValue = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = settings.parameter1 === 0
				? linearValue
				: Math.log(1 + settings.parameter1 * linearValue) / Math.log(1 + settings.parameter1);
			linearValue += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 5) {
		const amount = settings.parameter1 * Math.sqrt(3) / 100;
		const cubic = (value) => settings.parameter1 === 0 ? value : value - value ** 3 / 3;
		const gain = amount === 0 ? 1 : 1 / cubic(Math.min(amount, 1));
		let value = -amount;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = gain * cubic(value);
			for (let repeat = 0; repeat < settings.repeats; repeat += 1) {
				table[index] = gain * cubic(table[index] * amount);
			}
			value += amount / DISTORTION_STEPS;
		}
	} else if (mode === 6) {
		const amount = settings.parameter1 / -100;
		const shape = Math.max(0.001, settings.parameter2) / 10;
		let value = -1;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = (1 + amount) * value
				- value * (amount / Math.tanh(shape)) * Math.tanh(shape * value);
			value += 1 / DISTORTION_STEPS;
		}
	} else if (mode === 7) {
		const iterations = Math.floor(settings.parameter1 / 20);
		const fraction = settings.parameter1 / 20 - iterations;
		let linearValue = 0;
		for (let index = DISTORTION_STEPS; index < DISTORTION_TABLE_SIZE; index += 1) {
			let value = linearValue;
			for (let iteration = 0; iteration < iterations; iteration += 1) {
				value = (1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2;
			}
			value += ((1 + Math.sin(value * Math.PI - Math.PI / 2)) / 2 - value) * fraction;
			table[index] = value;
			linearValue += 1 / DISTORTION_STEPS;
		}
		copyPositiveHalf();
	} else if (mode === 8) {
		makeLevellerTable(table, settings, copyPositiveHalf);
	} else if (mode === 9) {
		const amount = settings.parameter1 / 50 - 1;
		for (let index = 0; index <= DISTORTION_STEPS; index += 1) {
			table[DISTORTION_STEPS + index] = index / DISTORTION_STEPS;
		}
		for (let index = 1; index <= DISTORTION_STEPS; index += 1) {
			table[DISTORTION_STEPS - index] = index / DISTORTION_STEPS * amount;
		}
	}

	return { table, makeupGain };
}

function makeLevellerTable(table, settings, copyPositiveHalf) {
	const noiseFloor = dbToLinear(settings.noiseFloorDb);
	const gainFactors = [0.8, 1, 1.2, 1.2, 1, 0.8];
	const gainLimits = [0.0001, noiseFloor, 0.1, 0.3, 0.5, 1];
	const addOnValues = [0];
	for (let index = 0; index < gainFactors.length - 1; index += 1) {
		addOnValues[index + 1] = addOnValues[index]
			+ gainLimits[index] * (gainFactors[index] - gainFactors[index + 1]);
	}
	for (let tableIndex = DISTORTION_STEPS; tableIndex < DISTORTION_TABLE_SIZE; tableIndex += 1) {
		let value = (tableIndex - DISTORTION_STEPS) / DISTORTION_STEPS;
		for (let pass = 0; pass < settings.repeats; pass += 1) {
			const gainIndex = levellerGainIndex(value, gainLimits);
			value = value * gainFactors[gainIndex] + addOnValues[gainIndex];
		}
		const fractionalPass = settings.parameter1 / 100;
		if (fractionalPass > 0.001) {
			const gainIndex = levellerGainIndex(value, gainLimits);
			value += fractionalPass * (
				value * (gainFactors[gainIndex] - 1) + addOnValues[gainIndex]
			);
		}
		table[tableIndex] = value;
	}
	copyPositiveHalf();
}

function levellerGainIndex(value, gainLimits) {
	let index = gainLimits.length - 1;
	for (let candidate = index; candidate >= 0 && value < gainLimits[candidate]; candidate -= 1) index = candidate;
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

function createDcState(length) {
	return { samples: new Float32Array(length), length, size: 0, position: 0, total: 0 };
}

function dcFilter(sample, state) {
	state.total += sample;
	if (state.size < state.length) {
		state.samples[state.position] = sample;
		state.size += 1;
	} else {
		state.total -= state.samples[state.position];
		state.samples[state.position] = sample;
	}
	state.position = (state.position + 1) % state.length;
	return sample - state.total / state.size;
}

function classicFilterCoefficients(settings, nyquist) {
	const subtype = settings.direction === 'lowpass' ? 0 : 1;
	if (settings.family === 'butterworth') {
		return butterworthCoefficients(settings.order, nyquist, settings.cutoffHz, subtype);
	}
	if (settings.family === 'chebyshev-i') {
		return chebyshevOneCoefficients(
			settings.order, nyquist, settings.cutoffHz, settings.passbandRippleDb, subtype,
		);
	}
	return chebyshevTwoCoefficients(
		settings.order, nyquist, settings.cutoffHz, settings.stopbandAttenuationDb, subtype,
	);
}

function createBiquads(order) {
	return Array.from({ length: Math.floor((order + 1) / 2) }, () => ({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }));
}

function normalizedCutoff(nyquist, cutoff) {
	return Math.min(cutoff / nyquist, 0.9999);
}

function butterworthCoefficients(order, nyquist, cutoff, subtype) {
	const biquads = createBiquads(order);
	const normalized = normalizedCutoff(nyquist, cutoff);
	const warped = Math.tan(Math.PI * normalized / 2);
	let poleDistance = 1;
	if (order % 2 === 0) {
		for (let pair = 0; pair < order / 2; pair += 1) {
			const pole = bilinearTransform(
				warped * Math.cos(Math.PI - (pair + 0.5) * Math.PI / order),
				warped * Math.sin(Math.PI - (pair + 0.5) * Math.PI / order),
			);
			setButterworthPair(biquads[pair], pole, subtype);
			poleDistance *= distanceSquared(subtype === 0 ? 1 : -1, 0, pole[0], pole[1]);
		}
	} else {
		const pole = bilinearTransform(-warped, 0);
		biquads[0].b0 = 1;
		biquads[0].b1 = subtype === 0 ? 1 : -1;
		biquads[0].b2 = 0;
		biquads[0].a1 = -pole[0];
		biquads[0].a2 = 0;
		poleDistance = subtype === 0 ? 1 - pole[0] : pole[0] + 1;
		for (let pair = 1; pair <= Math.floor(order / 2); pair += 1) {
			const pairPole = bilinearTransform(
				warped * Math.cos(Math.PI - pair * Math.PI / order),
				warped * Math.sin(Math.PI - pair * Math.PI / order),
			);
			setButterworthPair(biquads[pair], pairPole, subtype);
			poleDistance *= distanceSquared(subtype === 0 ? 1 : -1, 0, pairPole[0], pairPole[1]);
		}
	}
	const normalization = poleDistance / 2 ** order;
	biquads[0].b0 *= normalization;
	biquads[0].b1 *= normalization;
	biquads[0].b2 *= normalization;
	return biquads;
}

function setButterworthPair(biquad, pole, subtype) {
	biquad.b0 = 1;
	biquad.b1 = subtype === 0 ? 2 : -2;
	biquad.b2 = 1;
	biquad.a1 = -2 * pole[0];
	biquad.a2 = pole[0] ** 2 + pole[1] ** 2;
}

function chebyshevOneCoefficients(order, nyquist, cutoff, ripple, subtype) {
	const biquads = createBiquads(order);
	const normalized = normalizedCutoff(nyquist, cutoff);
	const warped = Math.tan(Math.PI * normalized / 2);
	const beta = Math.cos(normalized * Math.PI);
	const epsilon = Math.sqrt(10 ** (Math.max(0.001, ripple) / 10) - 1);
	const scale = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;
	for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
		const analogX = -warped * Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order));
		const analogY = warped * Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order));
		let pole = bilinearTransform(analogX, analogY);
		let zeroX;
		let distance;
		if (subtype === 0) {
			zeroX = -1;
			distance = distanceSquared(1, 0, pole[0], pole[1]) / 4;
		} else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zeroX = 1;
			distance = distanceSquared(-1, 0, pole[0], pole[1]) / 4;
		}
		biquads[pair] = {
			b0: distance,
			b1: -2 * zeroX * distance,
			b2: distance,
			a1: -2 * pole[0],
			a2: pole[0] ** 2 + pole[1] ** 2,
		};
	}
	if (order % 2 === 0) {
		const attenuation = dbToLinear(-Math.max(0.001, ripple));
		biquads[0].b0 *= attenuation;
		biquads[0].b1 *= attenuation;
		biquads[0].b2 *= attenuation;
	} else {
		let pole = bilinearTransform(-warped * Math.sinh(scale), 0);
		let zeroX;
		let distance;
		if (subtype === 0) {
			zeroX = -1;
			distance = Math.sqrt(distanceSquared(1, 0, pole[0], pole[1])) / 2;
		} else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zeroX = 1;
			distance = Math.sqrt(distanceSquared(-1, 0, pole[0], pole[1])) / 2;
		}
		biquads[Math.floor((order - 1) / 2)] = {
			b0: distance,
			b1: -zeroX * distance,
			b2: 0,
			a1: -pole[0],
			a2: 0,
		};
	}
	return biquads;
}

function chebyshevTwoCoefficients(order, nyquist, cutoff, ripple, subtype) {
	const biquads = createBiquads(order);
	const normalized = normalizedCutoff(nyquist, cutoff);
	const warped = Math.tan(Math.PI * normalized / 2);
	const beta = Math.cos(normalized * Math.PI);
	const epsilon = dbToLinear(-Math.max(0.001, ripple));
	const scale = Math.log(1 / epsilon + Math.sqrt(1 / epsilon ** 2 + 1)) / order;
	let analogPoleX;
	let analogPoleY;

	for (let pair = 0; pair < Math.floor(order / 2); pair += 1) {
		[analogPoleX, analogPoleY] = complexDivide(
			warped,
			0,
			-Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order)),
			Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order)),
		);
		let pole = bilinearTransform(analogPoleX, analogPoleY);
		let zero = bilinearTransform(0, warped / Math.cos((2 * pair + 1) * Math.PI / (2 * order)));
		let distance;
		if (subtype === 0) {
			distance = distanceSquared(1, 0, pole[0], pole[1]) / distanceSquared(1, 0, zero[0], zero[1]);
		} else {
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -beta * pole[1]);
			zero = complexDivide(beta - zero[0], -zero[1], 1 - beta * zero[0], -beta * zero[1]);
			distance = distanceSquared(-1, 0, pole[0], pole[1]) / distanceSquared(-1, 0, zero[0], zero[1]);
		}
		biquads[pair] = {
			b0: distance,
			b1: -2 * zero[0] * distance,
			b2: (zero[0] ** 2 + zero[1] ** 2) * distance,
			a1: -2 * pole[0],
			a2: pole[0] ** 2 + pole[1] ** 2,
		};
	}

	if (order % 2 === 1) {
		const pair = Math.floor((order - 1) / 2);
		[analogPoleX, analogPoleY] = complexDivide(
			warped,
			0,
			-Math.sinh(scale) * Math.sin((2 * pair + 1) * Math.PI / (2 * order)),
			Math.cosh(scale) * Math.cos((2 * pair + 1) * Math.PI / (2 * order)),
		);
		let pole = bilinearTransform(analogPoleX, analogPoleY);
		let zeroX;
		let distance;
		if (subtype === 0) {
			zeroX = -1;
			distance = Math.sqrt(distanceSquared(1, 0, pole[0], pole[1])) / 2;
		} else {
			// Preserve Audacity 3.7.7's first-order high-pass transform exactly.
			pole = complexDivide(beta - pole[0], -pole[1], 1 - beta * pole[0], -pole[1]);
			zeroX = 1;
			distance = Math.sqrt(distanceSquared(-1, 0, pole[0], pole[1])) / 2;
		}
		biquads[pair] = {
			b0: distance,
			b1: -zeroX * distance,
			b2: 0,
			a1: -pole[0],
			a2: 0,
		};
	}
	return biquads;
}

function complexDivide(numeratorReal, numeratorImaginary, denominatorReal, denominatorImaginary) {
	const denominator = denominatorReal ** 2 + denominatorImaginary ** 2;
	return [
		(numeratorReal * denominatorReal + numeratorImaginary * denominatorImaginary) / denominator,
		(numeratorImaginary * denominatorReal - numeratorReal * denominatorImaginary) / denominator,
	];
}

function bilinearTransform(x, y) {
	const denominator = (1 - x) ** 2 + y ** 2;
	return [(1 - x ** 2 - y ** 2) / denominator, 2 * y / denominator];
}

function distanceSquared(x1, y1, x2, y2) {
	// Audacity's helper returns float even though its arguments are doubles.
	return Math.fround((x1 - x2) ** 2 + (y1 - y2) ** 2);
}
