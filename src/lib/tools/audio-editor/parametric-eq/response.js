import { designParametricEq, sectionMagnitudeSquared } from './design.js';

export function evaluateParametricEqResponse(params, sampleRate, frequencies) {
	const frequencyValues = frequencies == null
		? createParametricEqFrequencyGrid(sampleRate)
		: normalizeFrequencies(frequencies, sampleRate);
	const configuration = designParametricEq(params, sampleRate);
	const response = new Float64Array(frequencyValues.length);
	for (let frequencyIndex = 0; frequencyIndex < frequencyValues.length; frequencyIndex += 1) {
		let decibels = configuration.packet.outputGainDb;
		const frequency = frequencyValues[frequencyIndex];
		for (const section of configuration.sections) {
			if (section.bandWet === false) continue;
			decibels += 10 * Math.log10(sectionMagnitudeSquared(section.coefficients, frequency, configuration.sampleRate));
		}
		response[frequencyIndex] = Number.isFinite(decibels) ? decibels : -600;
	}
	return response;
}

export function createParametricEqFrequencyGrid(sampleRate, length = 256) {
	const rate = normalizeSampleRate(sampleRate);
	const size = Math.max(2, Math.min(8_192, Math.round(Number(length) || 256)));
	const minimum = 10;
	const maximum = Math.max(minimum, Math.min(24_000, rate * 0.49));
	const ratio = maximum / minimum;
	return Float64Array.from({ length: size }, (_, index) => (
		minimum * ratio ** (index / (size - 1))
	));
}

function normalizeFrequencies(frequencies, sampleRate) {
	if (!Array.isArray(frequencies) && !ArrayBuffer.isView(frequencies)) {
		throw new TypeError('Parametric EQ frequencies must be an array or typed array.');
	}
	const rate = normalizeSampleRate(sampleRate);
	return Float64Array.from(frequencies, (frequency) => {
		const number = Number(frequency);
		if (!Number.isFinite(number) || number < 0 || number > rate / 2) {
			throw new RangeError('Parametric EQ response frequencies must be between DC and Nyquist.');
		}
		return number;
	});
}

function normalizeSampleRate(value) {
	const sampleRate = Number(value);
	if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
		throw new RangeError('Parametric EQ sample rate must be between 8,000 and 768,000 Hz.');
	}
	return sampleRate;
}
