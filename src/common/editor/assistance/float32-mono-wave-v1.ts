/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict admission for the adapter-owned Float32 mono WAV preparation format. */

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MAXIMUM_CHUNKS = 64;

export interface AssistanceFloat32MonoWaveV1 {
	readonly sampleRate: number;
	readonly samples: Float32Array;
}

export function reviewAssistanceFloat32MonoWaveV1(
	value: Uint8Array,
	expectedSampleRate: number,
): AssistanceFloat32MonoWaveV1 {
	if (!(value instanceof Uint8Array) || value.byteLength < 44) {
		throw new TypeError('Assistance audio must be a complete RIFF Float32 WAV.');
	}
	if (!Number.isSafeInteger(expectedSampleRate) || expectedSampleRate < 8_000
		|| expectedSampleRate > 192_000) {
		throw new RangeError('The expected assistance WAV sample rate is invalid.');
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	if (ascii(value, 0, 4) !== 'RIFF' || ascii(value, 8, 4) !== 'WAVE'
		|| view.getUint32(4, true) !== value.byteLength - 8) {
		throw new Error('Assistance audio requires one exact little-endian RIFF WAV payload.');
	}
	let offset = RIFF_HEADER_BYTES;
	let formatSeen = false;
	let dataOffset: number | null = null;
	let dataByteLength: number | null = null;
	let chunks = 0;
	while (offset < value.byteLength) {
		if (chunks >= MAXIMUM_CHUNKS || offset + CHUNK_HEADER_BYTES > value.byteLength) {
			throw new RangeError('The assistance WAV chunk inventory is malformed or oversized.');
		}
		chunks += 1;
		const id = ascii(value, offset, 4);
		const byteLength = view.getUint32(offset + 4, true);
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		const payloadEnd = payloadOffset + byteLength;
		const paddedEnd = payloadEnd + (byteLength & 1);
		if (!Number.isSafeInteger(payloadEnd) || paddedEnd > value.byteLength) {
			throw new Error('The assistance WAV contains a truncated RIFF chunk.');
		}
		if ((byteLength & 1) !== 0 && value[payloadEnd] !== 0) {
			throw new Error('The assistance WAV contains a non-zero RIFF alignment byte.');
		}
		if (id === 'fmt ') {
			if (formatSeen || byteLength !== 16) {
				throw new TypeError('Assistance audio requires one canonical Float32 WAV format chunk.');
			}
			assertFormat(view, payloadOffset, expectedSampleRate);
			formatSeen = true;
		} else if (id === 'data') {
			if (dataOffset !== null || byteLength < 4 || byteLength % 4 !== 0) {
				throw new RangeError('Assistance audio requires one non-empty aligned Float32 data chunk.');
			}
			dataOffset = payloadOffset;
			dataByteLength = byteLength;
		}
		offset = paddedEnd;
	}
	if (offset !== value.byteLength || !formatSeen || dataOffset === null || dataByteLength === null) {
		throw new Error('The assistance WAV is missing its exact format or audio data authority.');
	}
	const samples = new Float32Array(dataByteLength / Float32Array.BYTES_PER_ELEMENT);
	for (let index = 0; index < samples.length; index += 1) {
		const sample = view.getFloat32(dataOffset + index * Float32Array.BYTES_PER_ELEMENT, true);
		if (!Number.isFinite(sample)) {
			throw new RangeError('Every assistance WAV sample must be finite.');
		}
		samples[index] = sample;
	}
	return Object.freeze({ sampleRate: expectedSampleRate, samples });
}

function assertFormat(view: DataView, offset: number, sampleRate: number): void {
	if (view.getUint16(offset, true) !== 3
		|| view.getUint16(offset + 2, true) !== 1
		|| view.getUint32(offset + 4, true) !== sampleRate
		|| view.getUint32(offset + 8, true) !== sampleRate * 4
		|| view.getUint16(offset + 12, true) !== 4
		|| view.getUint16(offset + 14, true) !== 32) {
		throw new RangeError('Assistance audio must be exact mono IEEE Float32 at the requested rate.');
	}
}

function ascii(value: Uint8Array, offset: number, length: number): string {
	let result = '';
	for (let index = 0; index < length; index += 1) {
		result += String.fromCharCode(value[offset + index]!);
	}
	return result;
}
