/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The Audacity 3.7.7 Distortion waveshaper, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/DistortionBase.cpp, by Steve Daulton and
 * Dominic Mazzoni, GPL-2.0-or-later upstream. This modified JavaScript
 * adaptation was created for kw.media in 2026 and selects GPL version 3.
 *
 * The eleven waveshaper tables and the DC blocker are built once and shared by
 * Audacity's one-shot and realtime Distortion, so a distorted playback and a
 * distorted render read the same table.
 */

export const DISTORTION_STEPS = 1024;
export const DISTORTION_TABLE_SIZE = DISTORTION_STEPS * 2 + 1;

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

function dbToLinear(db) {
	return Math.exp(Math.log(10) * db / 20);
}

export function makeDistortionTable(settings) {
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
		let value = amount === 0 ? -1 : -amount;
		for (let index = 0; index < DISTORTION_TABLE_SIZE; index += 1) {
			table[index] = gain * cubic(value);
			for (let repeat = 0; amount !== 0 && repeat < settings.repeats; repeat += 1) {
				table[index] = gain * cubic(table[index] * amount);
			}
			value += (amount === 0 ? 1 : amount) / DISTORTION_STEPS;
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

export function distortionWaveShaper(input, table, mode, parameter1) {
	let sample = input;
	if (mode === 0) sample = Math.fround(sample * (1 + parameter1 / 100));
	let index = Math.floor(sample * DISTORTION_STEPS) + DISTORTION_STEPS;
	index = Math.max(0, Math.min(index, DISTORTION_STEPS * 2 - 1));
	let offset = Math.fround(1 + sample) * DISTORTION_STEPS - index;
	offset = Math.max(0, Math.min(offset, 1));
	return Math.fround(table[index] + (table[index + 1] - table[index]) * offset);
}

export function createDcState(length) {
	return { samples: new Float32Array(length), length, size: 0, position: 0, total: 0 };
}

export function dcFilter(sample, state) {
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
