/* SPDX-License-Identifier: AGPL-3.0-only */

export type NormalizedIirCoefficients = readonly [b0: number, b1: number, b2: number, a1: number, a2: number];

function maximumPoleMagnitude(a1: number, a2: number): number {
	if (a2 === 0) return Math.abs(a1);
	const discriminant = a1 * a1 - 4 * a2;
	if (discriminant < 0) return Math.sqrt(a2);
	const root = -.5 * (a1 + (a1 < 0 ? -1 : 1) * Math.sqrt(discriminant));
	return Math.max(Math.abs(root), root === 0 ? 0 : Math.abs(a2 / root));
}

/** Bound a charged cascade's release below -80 dB for input peaks at one.
 * The binomial envelope handles distinct, conjugate and repeated poles.
 */
export function iirReleaseBoundFrames(coefficients: readonly NormalizedIirCoefficients[]): number {
	let radius = 0;
	let poles = 0;
	let degree = 0;
	let logNumerator = Math.log(4);
	for (const [b0, b1, b2, a1, a2] of coefficients) {
		radius = Math.max(radius, maximumPoleMagnitude(a1, a2));
		poles += a2 !== 0 ? 2 : a1 !== 0 ? 1 : 0;
		degree += b2 !== 0 ? 2 : b1 !== 0 ? 1 : 0;
		logNumerator += Math.log(Math.abs(b0) + Math.abs(b1) + Math.abs(b2));
	}
	if (radius === 0 || poles === 0) return degree;
	if (!Number.isFinite(radius) || radius >= 1) throw new RangeError('The filter poles must be stable to estimate their release.');
	const logRadius = Math.log(radius);
	const logTarget = Math.log(.0001);
	const logReleaseBound = (frames: number): number => {
		const lag = frames + 1;
		if (lag < degree) return Infinity;
		const logRatio = logRadius + Math.log1p((poles - 1) / (lag + 1));
		if (logRatio >= 0) return Infinity;
		let logBound = logNumerator + (lag - degree) * logRadius - Math.log(-Math.expm1(logRatio));
		for (let term = 1; term < poles; term++) logBound += Math.log((lag + term) / term);
		return logBound;
	};
	let lower = 0;
	let upper = Math.max(degree + 1, Math.ceil((poles - 1) / (1 - radius)) + 1);
	while (logReleaseBound(upper) > logTarget) {
		if (upper > Number.MAX_SAFE_INTEGER / 2) throw new RangeError('The filter release estimate is too large.');
		upper *= 2;
	}
	while (upper - lower > 1) {
		const middle = Math.floor(lower + (upper - lower) / 2);
		if (logReleaseBound(middle) > logTarget) lower = middle;
		else upper = middle;
	}
	return upper + 1;
}
