/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Reconstructing a short damaged span from the audio either side of it, by
 * least-squares autoregression with a linear fallback. Adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/Repair.cpp and
 * libraries/lib-math/InterpolateAudio.cpp, by Dominic Mazzoni,
 * GPL-2.0-or-later upstream. This modified JavaScript adaptation was created
 * for kw.media in 2026 and selects GPL version 3. Split out of spectral.js; no
 * behaviour changes here.
 */

export function interpolateAudioLsar(buffer, firstBad, badCount, random) {
	const length = buffer.length;
	if (badCount >= length) return;
	if (firstBad === 0) {
		const reversed = new Float64Array(length);
		for (let index = 0; index < length; index += 1) reversed[length - 1 - index] = buffer[index];
		interpolateAudioLsar(reversed, length - badCount, badCount, random);
		for (let index = 0; index < length; index += 1) buffer[length - 1 - index] = reversed[index];
		return;
	}

	const rightCount = length - firstBad - badCount;
	const order = Math.min(badCount * 3, 50, Math.max(firstBad - 1, rightCount - 1));
	if (order < 3 || order >= length) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}

	const signal = new Float64Array(buffer);
	for (let index = 0; index < signal.length; index += 1) signal[index] += (random() - 0.5) / 10_000;
	const covariance = new Float64Array(order * order);
	const target = new Float64Array(order);
	for (let start = 0; start + order < length; start += 1) {
		if (!(start + order < firstBad || start >= firstBad + badCount)) continue;
		for (let row = 0; row < order; row += 1) {
			const rowValue = signal[start + row];
			target[row] += signal[start + order] * rowValue;
			for (let column = 0; column < order; column += 1) {
				covariance[row * order + column] += rowValue * signal[start + column];
			}
		}
	}
	const coefficients = solveLinearSystem(covariance, target, order);
	if (!coefficients) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}

	const normal = new Float64Array(badCount * badCount);
	const rightHandSide = new Float64Array(badCount);
	for (let row = 0; row < length - order; row += 1) {
		let knownContribution = 0;
		const unknownCoefficients = new Float64Array(badCount);
		for (let columnOffset = 0; columnOffset <= order; columnOffset += 1) {
			const column = row + columnOffset;
			const value = columnOffset === order ? 1 : -coefficients[columnOffset];
			if (column >= firstBad && column < firstBad + badCount) {
				unknownCoefficients[column - firstBad] += value;
			} else {
				knownContribution += value * signal[column];
			}
		}
		for (let left = 0; left < badCount; left += 1) {
			const leftValue = unknownCoefficients[left];
			if (leftValue === 0) continue;
			rightHandSide[left] -= leftValue * knownContribution;
			for (let right = 0; right < badCount; right += 1) {
				normal[left * badCount + right] += leftValue * unknownCoefficients[right];
			}
		}
	}
	const repaired = solveLinearSystem(normal, rightHandSide, badCount);
	if (!repaired) {
		linearInterpolateAudio(buffer, firstBad, badCount);
		return;
	}
	for (let index = 0; index < badCount; index += 1) buffer[firstBad + index] = repaired[index];
}

function linearInterpolateAudio(buffer, firstBad, badCount) {
	const end = firstBad + badCount;
	const decay = 0.9;
	if (firstBad === 0) {
		let value = buffer[end];
		let delta = end + 1 < buffer.length ? buffer[end] - buffer[end + 1] : 0;
		for (let index = end - 1; index >= 0; index -= 1) {
			value += delta;
			buffer[index] = value;
			value *= decay;
			delta *= decay;
		}
		return;
	}
	if (end === buffer.length) {
		let value = buffer[firstBad - 1];
		let delta = firstBad >= 2 ? buffer[firstBad - 1] - buffer[firstBad - 2] : 0;
		for (let index = firstBad; index < end; index += 1) {
			value += delta;
			buffer[index] = value;
			value *= decay;
			delta *= decay;
		}
		return;
	}
	const left = buffer[firstBad - 1];
	const right = buffer[end];
	const delta = (right - left) / (badCount + 1);
	for (let index = 0; index < badCount; index += 1) buffer[firstBad + index] = left + delta * (index + 1);
}

function solveLinearSystem(matrix, vector, size) {
	if (size === 0) return new Float64Array(0);
	const a = new Float64Array(matrix);
	const b = new Float64Array(vector);
	let scale = 0;
	for (const value of a) scale = Math.max(scale, Math.abs(value));
	const tolerance = Math.max(Number.MIN_VALUE, scale * Number.EPSILON * size * 8);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		let pivotValue = Math.abs(a[column * size + column]);
		for (let row = column + 1; row < size; row += 1) {
			const candidate = Math.abs(a[row * size + column]);
			if (candidate > pivotValue) {
				pivot = row;
				pivotValue = candidate;
			}
		}
		if (!(pivotValue > tolerance)) return null;
		if (pivot !== column) {
			for (let index = column; index < size; index += 1) {
				const temporary = a[column * size + index];
				a[column * size + index] = a[pivot * size + index];
				a[pivot * size + index] = temporary;
			}
			const temporary = b[column];
			b[column] = b[pivot];
			b[pivot] = temporary;
		}
		const divisor = a[column * size + column];
		for (let row = column + 1; row < size; row += 1) {
			const factor = a[row * size + column] / divisor;
			if (factor === 0) continue;
			a[row * size + column] = 0;
			for (let index = column + 1; index < size; index += 1) {
				a[row * size + index] -= factor * a[column * size + index];
			}
			b[row] -= factor * b[column];
		}
	}
	const result = new Float64Array(size);
	for (let row = size - 1; row >= 0; row -= 1) {
		let value = b[row];
		for (let column = row + 1; column < size; column += 1) value -= a[row * size + column] * result[column];
		result[row] = value / a[row * size + row];
		if (!Number.isFinite(result[row])) return null;
	}
	return result;
}
