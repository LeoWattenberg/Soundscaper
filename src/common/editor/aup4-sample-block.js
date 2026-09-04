/* SPDX-License-Identifier: AGPL-3.0-only */

// The Audacity 4 sample-block codec: the min/max/RMS summary pyramid Audacity
// stores alongside every block of samples, and the little-endian Float32
// payloads it stores them as. Split out of aup4-profile.js, which describes the
// document rather than the audio hung off it; no behaviour changes here.

import {
	AUP4_MAX_BLOCK_SAMPLES,
	AUP4_SAMPLE_FORMAT_FLOAT32,
	Aup4Error,
} from './aup4-profile-values.js';

const FLOAT32_MAX = 3.4028234663852886e38;

export function createAup4SampleBlock(input) {
	const samples = normalizeSamples(input);
	if (!samples.length || samples.length > AUP4_MAX_BLOCK_SAMPLES) {
		throw new Aup4Error(`AUP4 sample blocks must contain 1 to ${AUP4_MAX_BLOCK_SAMPLES} samples.`, 'INVALID_SAMPLE_COUNT');
	}
	const frames64k = Math.ceil(samples.length / 65_536);
	const frames256 = frames64k * 256;
	const usefulFrames256 = Math.ceil(samples.length / 256);
	const summary256 = new Float32Array(frames256 * 3);
	let totalSquares = 0;
	let fraction = 0;
	let usefulFinalSummaries = 256;

	for (let frame = 0; frame < usefulFrames256; frame += 1) {
		const start = frame * 256;
		const count = Math.min(256, samples.length - start);
		let minimum = samples[start];
		let maximum = samples[start];
		let squareSum = Math.fround(Math.fround(minimum) * Math.fround(minimum));
		if (count < 256) fraction = 1 - count / 256;
		for (let index = 1; index < count; index += 1) {
			const sample = samples[start + index];
			squareSum = Math.fround(squareSum + Math.fround(sample * sample));
			if (sample < minimum) minimum = sample;
			else if (sample > maximum) maximum = sample;
		}
		totalSquares += squareSum;
		const offset = frame * 3;
		summary256[offset] = minimum;
		summary256[offset + 1] = maximum;
		summary256[offset + 2] = Math.fround(Math.sqrt(squareSum / count));
	}

	for (let frame = usefulFrames256; frame < frames256; frame += 1) {
		usefulFinalSummaries -= 1;
		const offset = frame * 3;
		summary256[offset] = FLOAT32_MAX;
		summary256[offset + 1] = -FLOAT32_MAX;
		summary256[offset + 2] = 0;
	}

	const summary64k = new Float32Array(frames64k * 3);
	for (let frame = 0; frame < frames64k; frame += 1) {
		const start = frame * 256 * 3;
		let minimum = summary256[start];
		let maximum = summary256[start + 1];
		let squareSum = Math.fround(summary256[start + 2] * summary256[start + 2]);
		for (let index = 1; index < 256; index += 1) {
			const offset = start + index * 3;
			if (summary256[offset] < minimum) minimum = summary256[offset];
			if (summary256[offset + 1] > maximum) maximum = summary256[offset + 1];
			const rms = summary256[offset + 2];
			squareSum = Math.fround(squareSum + Math.fround(rms * rms));
		}
		const denominator = frame < frames64k - 1 ? 256 : usefulFinalSummaries - fraction;
		const offset = frame * 3;
		summary64k[offset] = minimum;
		summary64k[offset + 1] = maximum;
		summary64k[offset + 2] = Math.fround(Math.sqrt(squareSum / denominator));
	}

	let summin = summary64k[0];
	let summax = summary64k[1];
	for (let frame = 1; frame < frames64k; frame += 1) {
		summin = Math.min(summin, summary64k[frame * 3]);
		summax = Math.max(summax, summary64k[frame * 3 + 1]);
	}
	return {
		sampleformat: AUP4_SAMPLE_FORMAT_FLOAT32,
		summin,
		summax,
		sumrms: Math.sqrt(totalSquares / samples.length),
		summary256: float32ToLittleEndianBytes(summary256),
		summary64k: float32ToLittleEndianBytes(summary64k),
		samples: float32ToLittleEndianBytes(samples),
		sampleCount: samples.length,
	};
}

export function decodeAup4Float32Samples(input) {
	const bytes = toBytes(input);
	if (bytes.byteLength % 4) throw new Aup4Error('AUP4 Float32 sample data is not 4-byte aligned.', 'INVALID_SAMPLE_BLOCK');
	const output = new Float32Array(bytes.byteLength / 4);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0; index < output.length; index += 1) {
		const value = view.getFloat32(index * 4, true);
		output[index] = Number.isFinite(value) ? value : 0;
	}
	return output;
}

function float32ToLittleEndianBytes(values) {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index], true);
	return bytes;
}

function normalizeSamples(input) {
	if (input instanceof Float32Array) {
		if (input.every(Number.isFinite)) return input;
		return Float32Array.from(input, (value) => Number.isFinite(value) ? value : 0);
	}
	if (ArrayBuffer.isView(input) || Array.isArray(input)) return Float32Array.from(input, (value) => Number.isFinite(Number(value)) ? Number(value) : 0);
	throw new TypeError('A Float32 sample array is required.');
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('Binary sample data is required.');
}
