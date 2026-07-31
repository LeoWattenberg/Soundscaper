/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_EXACT_SQUARE_SUM_FRAMES = Math.floor(
	Number.MAX_SAFE_INTEGER / (32_768 ** 2),
);

export const DESKTOP_DIRECT_WAV_SIGNAL_LIMITS = Object.freeze({
	minimumNonzeroFrames: 6_300_000,
	minimumPositiveFrames: 3_100_000,
	minimumNegativeFrames: 3_100_000,
	minimumZeroCrossings: 7_240,
	maximumZeroCrossings: 7_280,
	minimumPeakAbsoluteSample: 9_175,
	maximumPeakAbsoluteSample: 10_486,
	maximumAbsoluteMeanSample: 16,
	minimumRmsSample: 6_554,
	maximumRmsSample: 7_373,
});
export const DESKTOP_DIRECT_PCM_SIGNAL_LIMITS = DESKTOP_DIRECT_WAV_SIGNAL_LIMITS;

const SIGNAL_KEYS = Object.freeze([
	'channelComparisons',
	'channelMismatchSamples',
	'frameCount',
	'maximumCarryBytes',
	'meanSample',
	'negativeFrames',
	'nonzeroFrames',
	'peakAbsoluteSample',
	'positiveFrames',
	'rmsSample',
	'sampleSquareSum',
	'sampleSum',
	'zeroCrossings',
]);

export function createDesktopDirectWavPcmSignalAnalyzer(geometry) {
	return createDesktopDirectPcmSignalAnalyzer(geometry);
}

export function createDesktopDirectPcmSignalAnalyzer(geometry, options = {}) {
	const expected = normalizeGeometry(geometry);
	const littleEndian = normalizeByteOrder(options.byteOrder) === 'little-endian';
	let carry = new Uint8Array(0);
	let maximumCarryBytes = 0;
	let frameCount = 0;
	let channelComparisons = 0;
	let channelMismatchSamples = 0;
	let nonzeroFrames = 0;
	let positiveFrames = 0;
	let negativeFrames = 0;
	let zeroCrossings = 0;
	let peakAbsoluteSample = 0;
	let sampleSum = 0;
	let sampleSquareSum = 0;
	let previousNonzeroSign = 0;
	let finished = false;

	return Object.freeze({ push, finish });

	function push(value) {
		if (finished) throw new Error('Desktop direct-WAV PCM signal analysis is finished');
		if (!(value instanceof Uint8Array)) {
			throw new TypeError('Desktop direct-WAV PCM signal chunks must be Uint8Array values');
		}
		if (!value.byteLength) return;
		const bytes = carry.byteLength ? concatenate(carry, value) : value;
		const completeBytes = bytes.byteLength - (bytes.byteLength % expected.blockAlign);
		if (completeBytes) analyzeFrames(bytes.subarray(0, completeBytes));
		carry = copyBytes(bytes.subarray(completeBytes));
		maximumCarryBytes = Math.max(maximumCarryBytes, carry.byteLength);
	}

	function finish() {
		if (finished) throw new Error('Desktop direct-WAV PCM signal analysis is finished');
		finished = true;
		if (carry.byteLength) {
			throw new Error(`Completed direct-WAV output ends with a ${String(carry.byteLength)}-byte partial PCM frame`);
		}
		if (frameCount !== expected.frameCount) {
			throw new Error(`Completed direct-WAV signal frame count is ${String(frameCount)}, expected ${String(expected.frameCount)}`);
		}
		return Object.freeze({
			frameCount,
			channelComparisons,
			channelMismatchSamples,
			maximumCarryBytes,
			nonzeroFrames,
			positiveFrames,
			negativeFrames,
			zeroCrossings,
			peakAbsoluteSample,
			sampleSum,
			sampleSquareSum,
			meanSample: sampleSum / frameCount,
			rmsSample: Math.sqrt(sampleSquareSum / frameCount),
		});
	}

	function analyzeFrames(bytes) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let offset = 0; offset < bytes.byteLength; offset += expected.blockAlign) {
			const sample = view.getInt16(offset, littleEndian);
			for (let channel = 1; channel < expected.channelCount; channel += 1) {
				channelComparisons += 1;
				if (view.getInt16(offset + channel * 2, littleEndian) !== sample) channelMismatchSamples += 1;
			}
			frameCount += 1;
			const absolute = Math.abs(sample);
			peakAbsoluteSample = Math.max(peakAbsoluteSample, absolute);
			sampleSum += sample;
			sampleSquareSum += sample * sample;
			if (sample === 0) continue;
			nonzeroFrames += 1;
			const sign = sample > 0 ? 1 : -1;
			if (sign > 0) positiveFrames += 1;
			else negativeFrames += 1;
			if (previousNonzeroSign && sign !== previousNonzeroSign) zeroCrossings += 1;
			previousNonzeroSign = sign;
		}
	}
}

export function validateDesktopDirectWavPcmSignalEvidence(
	value,
	geometry,
	limits = DESKTOP_DIRECT_WAV_SIGNAL_LIMITS,
) {
	const expected = normalizeGeometry(geometry);
	const bounds = normalizeLimits(limits, expected.frameCount);
	assertPlainRecord(value, 'PCM signal evidence');
	assertExactKeys(value, SIGNAL_KEYS, 'PCM signal evidence');
	if (value.frameCount !== expected.frameCount) {
		throw new Error('Direct-WAV PCM signal evidence has an invalid frame count');
	}
	const comparisons = expected.frameCount * (expected.channelCount - 1);
	if (value.channelComparisons !== comparisons) {
		throw new Error('Direct-WAV PCM signal evidence did not compare every output channel');
	}
	if (value.channelMismatchSamples !== 0) {
		throw new Error('Direct-WAV PCM signal channel mapping is not bit-identical');
	}
	if (!integerInRange(value.maximumCarryBytes, 0, expected.blockAlign - 1)) {
		throw new Error('Direct-WAV PCM signal carry exceeded one partial frame');
	}
	for (const field of ['nonzeroFrames', 'positiveFrames', 'negativeFrames']) {
		if (!integerInRange(value[field], 0, expected.frameCount)) {
			throw new Error(`Direct-WAV PCM signal ${field} is invalid`);
		}
	}
	if (value.nonzeroFrames !== value.positiveFrames + value.negativeFrames
		|| value.nonzeroFrames < bounds.minimumNonzeroFrames) {
		throw new Error('Direct-WAV PCM signal does not contain enough nonzero signal frames');
	}
	if (value.positiveFrames < bounds.minimumPositiveFrames
		|| value.negativeFrames < bounds.minimumNegativeFrames) {
		throw new Error('Direct-WAV PCM signal must contain enough positive and negative frames');
	}
	if (!integerInRange(value.zeroCrossings, 0, Math.max(0, value.nonzeroFrames - 1))
		|| value.zeroCrossings < bounds.minimumZeroCrossings
		|| value.zeroCrossings > bounds.maximumZeroCrossings) {
		throw new Error('Direct-WAV PCM signal crossing count is outside its reference bounds');
	}
	if (!integerInRange(value.peakAbsoluteSample, 0, 32_768)
		|| value.peakAbsoluteSample < bounds.minimumPeakAbsoluteSample
		|| value.peakAbsoluteSample > bounds.maximumPeakAbsoluteSample) {
		throw new Error('Direct-WAV PCM signal peak is outside its reference bounds');
	}
	const maximumSampleSum = expected.frameCount * 32_768;
	const maximumSquareSum = expected.frameCount * (32_768 ** 2);
	if (!integerInRange(value.sampleSum, -maximumSampleSum, maximumSampleSum)
		|| Math.abs(value.sampleSum) > expected.frameCount * value.peakAbsoluteSample
		|| value.meanSample !== value.sampleSum / expected.frameCount
		|| Math.abs(value.meanSample) > bounds.maximumAbsoluteMeanSample) {
		throw new Error('Direct-WAV PCM signal mean is outside its reference bounds');
	}
	if (!integerInRange(value.sampleSquareSum, 0, maximumSquareSum)
		|| value.sampleSquareSum < value.peakAbsoluteSample ** 2
		|| value.sampleSquareSum > expected.frameCount * value.peakAbsoluteSample ** 2
		|| value.rmsSample !== Math.sqrt(value.sampleSquareSum / expected.frameCount)
		|| value.rmsSample < 0
		|| value.rmsSample < Math.abs(value.meanSample)
		|| value.rmsSample > value.peakAbsoluteSample
		|| value.rmsSample < bounds.minimumRmsSample
		|| value.rmsSample > bounds.maximumRmsSample) {
		throw new Error('Direct-WAV PCM signal RMS is outside its reference bounds');
	}
	return Object.freeze({ ...value });
}

export const validateDesktopDirectPcmSignalEvidence = validateDesktopDirectWavPcmSignalEvidence;

function normalizeByteOrder(value) {
	const byteOrder = value ?? 'little-endian';
	if (byteOrder !== 'little-endian' && byteOrder !== 'big-endian') {
		throw new TypeError('Desktop direct-PCM byte order must be little-endian or big-endian');
	}
	return byteOrder;
}

function normalizeGeometry(value) {
	assertPlainRecord(value, 'PCM geometry');
	const channelCount = positiveInteger(value.channelCount, 'PCM channel count');
	const frameCount = positiveInteger(value.frameCount, 'PCM frame count');
	if (channelCount > 32) throw new RangeError('Desktop direct-WAV PCM supports at most 32 channels');
	if (value.bitDepth !== 16) throw new RangeError('Desktop direct-WAV PCM signal analysis requires 16-bit samples');
	if (frameCount > MAXIMUM_EXACT_SQUARE_SUM_FRAMES) {
		throw new RangeError('Desktop direct-WAV PCM frame count exceeds exact signal accumulation');
	}
	return { channelCount, frameCount, blockAlign: channelCount * 2 };
}

function normalizeLimits(value, frameCount) {
	assertPlainRecord(value, 'PCM signal limits');
	assertExactKeys(value, Object.keys(DESKTOP_DIRECT_WAV_SIGNAL_LIMITS), 'PCM signal limits');
	const limits = {};
	for (const field of [
		'minimumNonzeroFrames', 'minimumPositiveFrames', 'minimumNegativeFrames',
	]) {
		if (!integerInRange(value[field], 0, frameCount)) {
			throw new RangeError(`Desktop direct-WAV ${field} is invalid`);
		}
		limits[field] = value[field];
	}
	for (const field of ['minimumZeroCrossings', 'maximumZeroCrossings']) {
		if (!integerInRange(value[field], 0, frameCount - 1)) {
			throw new RangeError(`Desktop direct-WAV ${field} is invalid`);
		}
		limits[field] = value[field];
	}
	for (const field of ['minimumPeakAbsoluteSample', 'maximumPeakAbsoluteSample']) {
		if (!integerInRange(value[field], 0, 32_768)) {
			throw new RangeError(`Desktop direct-WAV ${field} is invalid`);
		}
		limits[field] = value[field];
	}
	for (const field of ['maximumAbsoluteMeanSample', 'minimumRmsSample', 'maximumRmsSample']) {
		if (!Number.isFinite(value[field]) || value[field] < 0 || value[field] > 32_768) {
			throw new RangeError(`Desktop direct-WAV ${field} is invalid`);
		}
		limits[field] = value[field];
	}
	if (limits.minimumPositiveFrames + limits.minimumNegativeFrames > frameCount
		|| limits.minimumZeroCrossings > limits.maximumZeroCrossings
		|| limits.minimumPeakAbsoluteSample > limits.maximumPeakAbsoluteSample
		|| limits.minimumRmsSample > limits.maximumRmsSample) {
		throw new RangeError('Desktop direct-WAV PCM signal limits are inconsistent');
	}
	return limits;
}

function concatenate(left, right) {
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
}

function copyBytes(value) {
	const result = new Uint8Array(value.byteLength);
	result.set(value);
	return result;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
	return value;
}

function integerInRange(value, minimum, maximum) {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop direct-WAV ${label} must be a plain object`);
	}
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError(`Desktop direct-WAV ${label} fields are invalid`);
	}
}
