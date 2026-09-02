/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Classic filter pole placement for the live Audacity filter processor.
 */

// Audacity's classic filters compute their ripple scaling with the exp/log form
// rather than exponentiation, and the two differ in the last bit at some orders.
function dbToLinear(db) { return Math.exp(Math.log(10) * db / 20); }

export function classicFilterCoefficients(settings, nyquist) {
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
