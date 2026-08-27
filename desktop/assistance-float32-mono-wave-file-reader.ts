/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict positioned-file admission for adapter-owned Float32 mono WAV input. */

import { open } from 'node:fs/promises';

import type { AssistanceBeatThisPcmSourceV1 } from
	'../src/common/editor/assistance/beat-this-log-mel-v1.ts';

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MAXIMUM_CHUNKS = 64;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MAXIMUM_RANGE_SAMPLES = 1_000_000;

export const ASSISTANCE_WAVE_MAXIMUM_FILE_READ_BYTES = 256 * 1024;

export interface AssistanceFloat32MonoWaveFileV1 extends AssistanceBeatThisPcmSourceV1 {
	readonly sampleRate: number;
	readonly byteLength: number;
	readonly maximumObservedFileReadBytes: number;
	close(): Promise<void>;
}

export async function openAssistanceFloat32MonoWaveFileV1(
	path: string,
	expectedSampleRate: number,
	expectedByteLength: number,
): Promise<AssistanceFloat32MonoWaveFileV1> {
	if (typeof path !== 'string' || path.length < 1 || path.length > 4_096) {
		throw new TypeError('Assistance WAV file reading requires a bounded path.');
	}
	if (!Number.isSafeInteger(expectedSampleRate) || expectedSampleRate < 8_000
		|| expectedSampleRate > 192_000 || !Number.isSafeInteger(expectedByteLength)
		|| expectedByteLength < 44 || expectedByteLength > 0xffff_ffff + 8) {
		throw new RangeError('The expected assistance WAV file geometry is invalid.');
	}
	const handle = await open(path, 'r');
	let maximumObservedFileReadBytes = 0;
	let closed = false;
	const positionedRead = async (position: number, byteLength: number): Promise<Uint8Array> => {
		if (closed) throw new Error('The assistance WAV file source is closed.');
		if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(byteLength)
			|| byteLength < 1 || position + byteLength > expectedByteLength) {
			throw new RangeError('The assistance WAV positioned read exceeds file authority.');
		}
		const bytes = new Uint8Array(byteLength);
		let offset = 0;
		while (offset < bytes.length) {
			const length = Math.min(ASSISTANCE_WAVE_MAXIMUM_FILE_READ_BYTES, bytes.length - offset);
			maximumObservedFileReadBytes = Math.max(maximumObservedFileReadBytes, length);
			const result = await handle.read(bytes, offset, length, position + offset);
			if (result.bytesRead !== length) {
				throw new Error('The assistance WAV file changed or ended during a positioned read.');
			}
			offset += length;
		}
		return bytes;
	};
	try {
		const stats = await handle.stat();
		if (!stats.isFile() || stats.size !== expectedByteLength) {
			throw new Error('The assistance WAV staged-file length or kind changed.');
		}
		const layout = await inspectWave(positionedRead, expectedByteLength, expectedSampleRate);
		return Object.freeze({
			sampleRate: expectedSampleRate,
			byteLength: expectedByteLength,
			sampleCount: layout.sampleCount,
			get maximumObservedFileReadBytes() { return maximumObservedFileReadBytes; },
			async readSamples(startSample: number, sampleCount: number, signal?: AbortSignal) {
				if (!Number.isSafeInteger(startSample) || startSample < 0
					|| !Number.isSafeInteger(sampleCount) || sampleCount < 1
					|| sampleCount > MAXIMUM_RANGE_SAMPLES
					|| startSample + sampleCount > layout.sampleCount) {
					throw new RangeError('The assistance WAV sample read exceeds its bounded authority.');
				}
				if (signal !== undefined && !(signal instanceof AbortSignal)) {
					throw new TypeError('The assistance WAV sample read cancellation signal is invalid.');
				}
				signal?.throwIfAborted();
				const bytes = await positionedRead(
					layout.dataOffset + startSample * FLOAT32_BYTES, sampleCount * FLOAT32_BYTES,
				);
				signal?.throwIfAborted();
				const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				const samples = new Float32Array(sampleCount);
				for (let index = 0; index < samples.length; index += 1) {
					const sample = view.getFloat32(index * FLOAT32_BYTES, true);
					if (!Number.isFinite(sample)) {
						throw new RangeError('Every assistance WAV sample must be finite.');
					}
					samples[index] = sample;
				}
				return samples;
			},
			async close() {
				if (closed) return;
				closed = true;
				await handle.close();
			},
		});
	} catch (error) {
		closed = true;
		await handle.close().catch(() => undefined);
		throw error;
	}
}

async function inspectWave(
	read: (position: number, byteLength: number) => Promise<Uint8Array>,
	byteLength: number,
	expectedSampleRate: number,
): Promise<Readonly<{ dataOffset: number; sampleCount: number }>> {
	const preamble = await read(0, RIFF_HEADER_BYTES);
	const preambleView = view(preamble);
	if (ascii(preamble, 0, 4) !== 'RIFF' || ascii(preamble, 8, 4) !== 'WAVE'
		|| preambleView.getUint32(4, true) !== byteLength - 8) {
		throw new Error('Assistance audio requires one exact little-endian RIFF WAV file.');
	}
	let offset = RIFF_HEADER_BYTES;
	let formatSeen = false;
	let dataOffset: number | null = null;
	let dataByteLength: number | null = null;
	let chunks = 0;
	while (offset < byteLength) {
		if (chunks >= MAXIMUM_CHUNKS || offset + CHUNK_HEADER_BYTES > byteLength) {
			throw new RangeError('The assistance WAV file chunk inventory is malformed or oversized.');
		}
		chunks += 1;
		const header = await read(offset, CHUNK_HEADER_BYTES);
		const id = ascii(header, 0, 4);
		const chunkByteLength = view(header).getUint32(4, true);
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		const payloadEnd = payloadOffset + chunkByteLength;
		const paddedEnd = payloadEnd + (chunkByteLength & 1);
		if (!Number.isSafeInteger(payloadEnd) || paddedEnd > byteLength) {
			throw new Error('The assistance WAV file contains a truncated RIFF chunk.');
		}
		if ((chunkByteLength & 1) !== 0 && (await read(payloadEnd, 1))[0] !== 0) {
			throw new Error('The assistance WAV file contains a non-zero alignment byte.');
		}
		if (id === 'fmt ') {
			if (formatSeen || chunkByteLength !== 16) {
				throw new TypeError('Assistance audio requires one canonical Float32 WAV format chunk.');
			}
			assertFormat(await read(payloadOffset, 16), expectedSampleRate);
			formatSeen = true;
		} else if (id === 'data') {
			if (dataOffset !== null || chunkByteLength < FLOAT32_BYTES
				|| chunkByteLength % FLOAT32_BYTES !== 0) {
				throw new RangeError('Assistance audio requires one aligned nonempty Float32 data chunk.');
			}
			dataOffset = payloadOffset;
			dataByteLength = chunkByteLength;
		}
		offset = paddedEnd;
	}
	if (offset !== byteLength || !formatSeen || dataOffset === null || dataByteLength === null) {
		throw new Error('The assistance WAV file is missing its exact format or data authority.');
	}
	return Object.freeze({ dataOffset, sampleCount: dataByteLength / FLOAT32_BYTES });
}

function assertFormat(bytes: Uint8Array, sampleRate: number): void {
	const format = view(bytes);
	if (format.getUint16(0, true) !== 3 || format.getUint16(2, true) !== 1
		|| format.getUint32(4, true) !== sampleRate
		|| format.getUint32(8, true) !== sampleRate * FLOAT32_BYTES
		|| format.getUint16(12, true) !== FLOAT32_BYTES
		|| format.getUint16(14, true) !== 32) {
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

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
