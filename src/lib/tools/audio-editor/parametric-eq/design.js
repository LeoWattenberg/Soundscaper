/*
 * Double-precision parametric EQ section design.
 *
 * Bells and cut filters follow Martin Vicanek's matched-second-order method:
 * analog poles are impulse-invariant and numerator coefficients are fitted in
 * the digital domain. Shelves use his matched two-pole Butterworth equations.
 * The resulting transfer functions are realized with Cytomic's input-mixing,
 * trapezoidal-integrated SVF rather than a direct-form recurrence.
 */

import { packParametricEqParams } from './parameters.js';

const PI = Math.PI;
const MIN_MAGNITUDE_SQUARED = 1e-60;

export function designParametricEq(params, sampleRate, options = {}) {
	const rate = normalizeSampleRate(sampleRate);
	const packet = packParametricEqParams(params, options.effectId);
	const auditionBandId = options.auditionBandId == null ? null : String(options.auditionBandId);
	const sections = [];
	for (const band of packet.bands) {
		if (auditionBandId != null && band.id !== auditionBandId) continue;
		const coefficients = auditionBandId == null
			? designBandSections(band, rate)
			: [designAuditionSection(band, rate)];
		for (let index = 0; index < coefficients.length; index += 1) {
			const coefficient = coefficients[index];
			const neutralGainBand = (band.type === 'peaking'
				|| band.type === 'lowshelf'
				|| band.type === 'highshelf')
				&& band.gainDb === 0;
			sections.push({
				bandId: band.id,
				bandType: band.type,
				// A neutral gain band still runs and keeps its state warm, but its
				// dry path is selected exactly so 0 dB is bit-transparent.
				bandEnabled: auditionBandId == null ? band.enabled : true,
				bandWet: auditionBandId == null ? band.enabled && !neutralGainBand : true,
				sectionIndex: index,
				coefficients: coefficient,
				tpt: biquadToTpt(coefficient),
			});
		}
	}
	return {
		packet,
		sampleRate: rate,
		auditionBandId,
		sections,
		outputGain: auditionBandId == null ? 10 ** (packet.outputGainDb / 20) : 1,
		outputGainDb: auditionBandId == null ? packet.outputGainDb : 0,
		topologyKey: sections.map((section) => `${section.bandId}:${section.bandType}:${section.sectionIndex}`).join('|'),
	};
}

export function designBandSections(band, sampleRate) {
	const frequency = effectiveFrequency(band.frequencyHz, sampleRate);
	if (band.type === 'lowshelf' || band.type === 'highshelf') {
		return [designMatchedShelf(band.type, frequency, band.gainDb, sampleRate)];
	}
	if (band.type === 'highpass' || band.type === 'lowpass') {
		const order = Math.max(2, Math.min(8, Math.round(band.slopeDbPerOctave / 6)));
		const sections = [];
		for (let index = 1; index <= order / 2; index += 1) {
			const q = 1 / (2 * Math.cos(((2 * index - 1) * PI) / (2 * order)));
			sections.push(designMatchedSection(band.type, frequency, q, 0, sampleRate));
		}
		return sections;
	}
	return [designMatchedSection(band.type, frequency, band.q, band.gainDb, sampleRate)];
}

export function designMatchedSection(type, frequency, qValue, gainDb, sampleRate) {
	if (type === 'peaking' && Number(gainDb) < 0) {
		return invertBiquad(designMatchedSection(type, frequency, qValue, -Number(gainDb), sampleRate));
	}
	const rate = normalizeSampleRate(sampleRate);
	const scaledFrequency = Math.max(1e-8, Math.min(0.49, Number(frequency) / rate));
	const w0 = 2 * PI * scaledFrequency;
	const userQ = Math.max(0.01, Number(qValue) || 1);
	const sqrtGain = 10 ** ((Number(gainDb) || 0) / 40);
	const inverseTwoQ = 0.5 / userQ;
	const designQ = type === 'peaking' ? userQ * sqrtGain : userQ;
	const poleQ = type === 'peaking' ? inverseTwoQ / sqrtGain : inverseTwoQ;
	const denominator = mappedDenominator(w0, poleQ);
	const { a1, a2, d0, dpi } = denominator;
	const sinHalf = Math.sin(w0 / 2);
	const p1 = sinHalf * sinHalf;
	const p0 = Math.max(0, 1 - p1);
	const p2 = 4 * p0 * p1;
	const A0 = d0 * d0;
	const A1 = dpi * dpi;
	const A2 = -4 * a2;
	let b0;
	let b1;
	let b2;

	if (type === 'lowpass') {
		const R1 = Math.max(0, (A0 * p0 + A1 * p1 + A2 * p2) * designQ * designQ);
		const B0 = A0;
		const B1 = Math.max(0, (R1 - B0 * p0) / p1);
		b0 = 0.5 * (Math.sqrt(B0) + Math.sqrt(B1));
		b1 = Math.sqrt(B0) - b0;
		b2 = 0;
	} else if (type === 'highpass') {
		b0 = Math.sqrt(Math.max(0, A0 * p0 + A1 * p1 + A2 * p2)) * designQ / (4 * p1);
		b1 = -2 * b0;
		b2 = b0;
	} else if (type === 'bandpass') {
		const R1 = A0 * p0 + A1 * p1 + A2 * p2;
		const R2 = -A0 + A1 + 4 * (p0 - p1) * A2;
		const B2 = (R1 - R2 * p1) / (4 * p1 * p1);
		const B1 = R2 + 4 * (p1 - p0) * B2;
		b1 = -0.5 * Math.sqrt(Math.max(0, B1));
		b0 = 0.5 * (Math.sqrt(Math.max(0, B2 + 0.25 * B1)) - b1);
		b2 = -b0 - b1;
	} else if (type === 'notch') {
		const scale = d0 / (4 * p1);
		b0 = scale;
		b1 = -2 * Math.cos(w0) * scale;
		b2 = scale;
	} else {
		const G2 = sqrtGain ** 4;
		const R1 = (A0 * p0 + A1 * p1 + A2 * p2) * G2;
		const R2 = (-A0 + A1 + 4 * (p0 - p1) * A2) * G2;
		const B0 = A0;
		const B2 = (R1 - R2 * p1 - B0) / (4 * p1 * p1);
		const B1 = R2 + B0 + 4 * (p1 - p0) * B2;
		const W = 0.5 * (Math.sqrt(B0) + Math.sqrt(Math.max(0, B1)));
		b0 = 0.5 * (W + Math.sqrt(Math.max(0, W * W + B2)));
		b1 = 0.5 * (Math.sqrt(B0) - Math.sqrt(Math.max(0, B1)));
		b2 = -B2 / (4 * b0);
	}

	let n0;
	let npi;
	if (type === 'peaking') {
		n0 = d0;
		// The matched fit is exactly unity at DC, but (unlike an analog bell)
		// its independently fitted digital numerator is not constrained to
		// unity at Nyquist.  This alternating sum is well-conditioned there.
		npi = b0 - b1 + b2;
	} else if (type === 'lowpass') {
		n0 = d0;
		npi = b0 - b1 + b2;
	} else if (type === 'highpass') {
		n0 = 0;
		npi = 4 * b0;
	} else if (type === 'bandpass') {
		n0 = 0;
		npi = -2 * b1;
	} else {
		n0 = d0;
		npi = 4 * p0 * (d0 / (4 * p1));
	}
	return validateCoefficients({ b0, b1, b2, a1, a2, d0, dpi, n0, npi });
}

export function designMatchedShelf(type, frequency, gainDb, sampleRate) {
	const rate = normalizeSampleRate(sampleRate);
	const fc = Math.max(2e-8, Math.min(0.98, Number(frequency) / (rate / 2)));
	const decibels = Number(gainDb) || 0;
	if (decibels < 0) return invertBiquad(designMatchedShelf(type, frequency, -decibels, sampleRate));
	const gain = 10 ** (decibels / 20);
	if (decibels === 0) return identityWithMatchedPoles(frequency, sampleRate);
	const lowShelf = type === 'lowshelf';
	const g = lowShelf ? 1 / gain : gain;
	const inverseGain = 1 / g;
	const fc2 = fc * fc;
	const fc4 = fc2 * fc2;
	const hNyquist = (fc4 + g) / (fc4 + inverseGain);
	const f1 = fc / Math.sqrt(0.160 + 1.543 * fc2);
	const f2 = fc / Math.sqrt(0.947 + 3.806 * fc2);
	const match1 = shelfMatch(fc4, f1, g, inverseGain);
	const match2 = shelfMatch(fc4, f2, g, inverseGain);
	const d1 = (match1.h - 1) * (1 - match1.phi);
	const d2 = (match2.h - 1) * (1 - match2.phi);
	const c11 = -match1.phi * d1;
	const c12 = match1.phi * match1.phi * (hNyquist - match1.h);
	const c21 = -match2.phi * d2;
	const c22 = match2.phi * match2.phi * (hNyquist - match2.h);
	const determinant = c11 * c22 - c12 * c21;
	const determinantScale = Math.abs(c11 * c22) + Math.abs(c12 * c21);
	if (!Number.isFinite(determinant) || !Number.isFinite(determinantScale)
		|| determinantScale === 0 || Math.abs(determinant) / determinantScale < 1e-12) {
		throw new RangeError('Parametric EQ generated an ill-conditioned matched shelf.');
	}
	const alpha1 = (c22 * d1 - c12 * d2) / determinant;
	const AA1 = (c11 * d2 - d1 * c21) / determinant;
	const BB1 = hNyquist * AA1;
	const AA2 = 0.25 * (alpha1 - AA1);
	const BB2 = 0.25 * (alpha1 - BB1);
	const sqrtAA1 = Math.sqrt(Math.max(0, AA1));
	const sqrtBB1 = Math.sqrt(Math.max(0, BB1));
	const v = 0.5 * (1 + sqrtAA1);
	const w = 0.5 * (1 + sqrtBB1);
	const a0 = 0.5 * (v + Math.sqrt(Math.max(0, v * v + AA2)));
	const inverseA0 = 1 / a0;
	const a1 = (1 - v) * inverseA0;
	const a2 = -0.25 * AA2 * inverseA0 * inverseA0;
	let b0;
	let b1;
	let b2;
	if (lowShelf) {
		const gainInverseA0 = inverseGain * inverseA0;
		b0 = 0.5 * (w + Math.sqrt(Math.max(0, w * w + BB2)));
		b1 = (1 - w) * gainInverseA0;
		b2 = (-0.25 * BB2 / b0) * gainInverseA0;
		b0 *= gainInverseA0;
	} else {
		b0 = 0.5 * (w + Math.sqrt(Math.max(0, w * w + BB2))) * inverseA0;
		b1 = (1 - w) * inverseA0;
		b2 = (-0.25 * BB2 / b0) * inverseA0 * inverseA0;
	}
	// Vicanek's construction gives these endpoint factors directly.  Keeping
	// them factored avoids reconstructing 1 ± a1 + a2 (or the equivalent
	// numerator sums) from nearly cancelling normalized coefficients.
	const endpointFactor = lowShelf ? inverseGain : 1;
	const d0 = inverseA0;
	const dpi = sqrtAA1 * inverseA0;
	return validateCoefficients({
		b0,
		b1,
		b2,
		a1,
		a2,
		d0,
		dpi,
		n0: endpointFactor * inverseA0,
		npi: endpointFactor * sqrtBB1 * inverseA0,
	});
}

export function biquadToTpt(coefficients) {
	const { b0, b1, b2, a1, a2 } = coefficients;
	const d0 = positiveEndpoint(coefficients.d0, 1 + a1 + a2);
	const dpi = positiveEndpoint(coefficients.dpi, 1 - a1 + a2);
	const n0 = finiteEndpoint(coefficients.n0, b0 + b1 + b2);
	const npi = finiteEndpoint(coefficients.npi, b0 - b1 + b2);
	const root = Math.sqrt(d0 * dpi);
	const tpt = {
		g: Math.sqrt(d0 / dpi),
		k: 2 * (1 - a2) / root,
		m0: npi / dpi,
		m1: 2 * (b0 - b2) / root,
		m2: n0 / d0,
	};
	for (const value of Object.values(tpt)) {
		if (!Number.isFinite(value)) throw new RangeError('Parametric EQ generated an invalid TPT section.');
	}
	if (!(tpt.g > 0) || !(tpt.k > 0)) throw new RangeError('Parametric EQ generated an unstable TPT section.');
	return tpt;
}

export function sectionMagnitudeSquared(coefficients, frequency, sampleRate) {
	const w = 2 * PI * Math.max(0, Math.min(sampleRate / 2, frequency)) / sampleRate;
	const tpt = biquadToTpt(coefficients);
	const x = Math.tan(w / 2) / tpt.g;
	let numeratorReal;
	let numeratorImag;
	let denominatorReal;
	let denominatorImag;
	if (Math.abs(x) <= 1) {
		const square = x * x;
		numeratorReal = tpt.m2 - tpt.m0 * square;
		numeratorImag = tpt.m1 * x;
		denominatorReal = 1 - square;
		denominatorImag = tpt.k * x;
	} else {
		const inverse = 1 / x;
		const square = inverse * inverse;
		numeratorReal = -tpt.m0 + tpt.m2 * square;
		numeratorImag = tpt.m1 * inverse;
		denominatorReal = -1 + square;
		denominatorImag = tpt.k * inverse;
	}
	const numerator = numeratorReal * numeratorReal + numeratorImag * numeratorImag;
	const denominator = denominatorReal * denominatorReal + denominatorImag * denominatorImag;
	return Math.max(MIN_MAGNITUDE_SQUARED, numerator / Math.max(MIN_MAGNITUDE_SQUARED, denominator));
}

function designAuditionSection(band, sampleRate) {
	const frequency = effectiveFrequency(band.frequencyHz, sampleRate);
	if (band.type === 'lowshelf' || band.type === 'highpass') {
		return designMatchedSection('lowpass', frequency, Math.max(0.5, band.q), 0, sampleRate);
	}
	if (band.type === 'highshelf' || band.type === 'lowpass') {
		return designMatchedSection('highpass', frequency, Math.max(0.5, band.q), 0, sampleRate);
	}
	return designMatchedSection('bandpass', frequency, band.q, 0, sampleRate);
}

function mappedDenominator(w0, q) {
	if (q <= 1) {
		const radius = Math.exp(-q * w0);
		const theta = Math.sqrt(Math.max(0, 1 - q * q)) * w0;
		const oneMinusRadius = -Math.expm1(-q * w0);
		const sinHalf = Math.sin(theta / 2);
		const cosHalf = Math.cos(theta / 2);
		return {
			a1: -2 * radius * Math.cos(theta),
			a2: radius * radius,
			d0: oneMinusRadius * oneMinusRadius + 4 * radius * sinHalf * sinHalf,
			dpi: oneMinusRadius * oneMinusRadius + 4 * radius * cosHalf * cosHalf,
		};
	}
	const spread = Math.sqrt(q * q - 1);
	const exponent1 = (-q + spread) * w0;
	const exponent2 = (-q - spread) * w0;
	const pole1 = Math.exp(exponent1);
	const pole2 = Math.exp(exponent2);
	return {
		a1: -(pole1 + pole2),
		a2: pole1 * pole2,
		d0: (-Math.expm1(exponent1)) * (-Math.expm1(exponent2)),
		dpi: (1 + pole1) * (1 + pole2),
	};
}

function identityWithMatchedPoles(frequency, sampleRate) {
	const scaledFrequency = Math.max(1e-8, Math.min(0.49, Number(frequency) / sampleRate));
	const denominator = mappedDenominator(2 * PI * scaledFrequency, 1 / Math.sqrt(2));
	return validateCoefficients({
		b0: 1,
		b1: denominator.a1,
		b2: denominator.a2,
		n0: denominator.d0,
		npi: denominator.dpi,
		...denominator,
	});
}

function invertBiquad(coefficients) {
	const scale = coefficients.b0;
	if (!Number.isFinite(scale) || Math.abs(scale) < 1e-18) {
		throw new RangeError('Parametric EQ cannot invert a non-minimum-phase bell section.');
	}
	const inverted = {
		b0: 1 / scale,
		b1: coefficients.a1 / scale,
		b2: coefficients.a2 / scale,
		a1: coefficients.b1 / scale,
		a2: coefficients.b2 / scale,
		d0: finiteEndpoint(coefficients.n0, coefficients.b0 + coefficients.b1 + coefficients.b2) / scale,
		dpi: finiteEndpoint(coefficients.npi, coefficients.b0 - coefficients.b1 + coefficients.b2) / scale,
		n0: coefficients.d0 / scale,
		npi: coefficients.dpi / scale,
	};
	return validateCoefficients(inverted);
}

function shelfMatch(fc4, frequency, gain, inverseGain) {
	const square = frequency * frequency;
	const fourth = square * square;
	const sin = Math.sin((PI / 2) * frequency);
	return {
		h: (fc4 + fourth * gain) / (fc4 + fourth * inverseGain),
		phi: sin * sin,
	};
}

function validateCoefficients(coefficients) {
	for (const key of ['b0', 'b1', 'b2', 'a1', 'a2', 'd0', 'dpi', 'n0', 'npi']) {
		if (!Number.isFinite(coefficients[key])) throw new RangeError(`Parametric EQ generated a non-finite ${key} coefficient.`);
	}
	if (!(coefficients.d0 > 0) || !(coefficients.dpi > 0)) {
		throw new RangeError('Parametric EQ generated poles outside the stable region.');
	}
	if (!(coefficients.a2 < 1) || !(coefficients.a2 > Math.abs(coefficients.a1) - 1)) {
		throw new RangeError('Parametric EQ generated poles outside the stable region.');
	}
	return coefficients;
}

function effectiveFrequency(value, sampleRate) {
	return Math.max(10, Math.min(24_000, sampleRate * 0.49, Number(value) || 1_000));
}

function normalizeSampleRate(value) {
	const sampleRate = Number(value);
	if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
		throw new RangeError('Parametric EQ sample rate must be between 8,000 and 768,000 Hz.');
	}
	return sampleRate;
}

function positiveEndpoint(preferred, fallback) {
	const value = Number.isFinite(preferred) && preferred > 0 ? preferred : fallback;
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('Parametric EQ generated an invalid endpoint gain.');
	return value;
}

function finiteEndpoint(preferred, fallback) {
	const value = Number.isFinite(preferred) ? preferred : fallback;
	if (!Number.isFinite(value)) throw new RangeError('Parametric EQ generated an invalid numerator endpoint.');
	return value;
}
