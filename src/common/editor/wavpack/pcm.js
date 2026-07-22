/* SPDX-License-Identifier: AGPL-3.0-only */

export const PCM_ENCODING_RAW_F32LE = 'raw-f32le';
export const PCM_ENCODING_WAVPACK_F32_V1 = 'wavpack-f32-v1';
export const WAVPACK_PCM_MAXIMUM_CHANNELS = 64;
export const WAVPACK_PCM_MAXIMUM_FRAMES = 65_536;
export const WAVPACK_PCM_MINIMUM_SAVINGS_BYTES = 4 * 1024;
export const WAVPACK_PCM_MINIMUM_SAVINGS_RATIO = 0.02;
export const WAVPACK_PCM_MAXIMUM_RAW_BYTES = (
	WAVPACK_PCM_MAXIMUM_CHANNELS
	* WAVPACK_PCM_MAXIMUM_FRAMES
	* Float32Array.BYTES_PER_ELEMENT
);

const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
let crcTable;

export function pcmRawByteLength(frames, channelCount) {
	const geometry = validatePcmGeometry(frames, channelCount);
	return geometry.frames * geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
}

export function validatePcmGeometry(frames, channelCount) {
	const normalizedFrames = Number(frames);
	const normalizedChannels = Number(channelCount);
	if (!Number.isSafeInteger(normalizedFrames)
		|| normalizedFrames < 1
		|| normalizedFrames > WAVPACK_PCM_MAXIMUM_FRAMES) {
		throw new RangeError(`PCM chunks must contain 1–${WAVPACK_PCM_MAXIMUM_FRAMES} frames.`);
	}
	if (!Number.isSafeInteger(normalizedChannels)
		|| normalizedChannels < 1
		|| normalizedChannels > WAVPACK_PCM_MAXIMUM_CHANNELS) {
		throw new RangeError(`PCM chunks must contain 1–${WAVPACK_PCM_MAXIMUM_CHANNELS} channels.`);
	}
	return { frames: normalizedFrames, channelCount: normalizedChannels };
}

export function normalizePcmSampleRate(value) {
	const sampleRate = Number(value);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000) {
		throw new RangeError('PCM sample rate must be an integer between 1 and 768,000 Hz.');
	}
	return sampleRate;
}

/**
 * Copy planar Float32 samples into one canonical little-endian buffer. This is
 * also the immediate ownership snapshot used before an async codec request.
 */
export function packPlanarFloat32(channels) {
	if (!Array.isArray(channels) || !channels.length) {
		throw new TypeError('At least one planar Float32 channel is required.');
	}
	const normalized = channels.map((channel) => (
		channel instanceof Float32Array ? channel : Float32Array.from(channel || [])
	));
	const frames = normalized[0].length;
	validatePcmGeometry(frames, normalized.length);
	if (normalized.some((channel) => channel.length !== frames)) {
		throw new RangeError('Planar PCM channels must have matching frame counts.');
	}
	const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
	const payload = new ArrayBuffer(channelBytes * normalized.length);
	const targetBytes = new Uint8Array(payload);
	if (littleEndian) {
		for (let channel = 0; channel < normalized.length; channel += 1) {
			targetBytes.set(new Uint8Array(
				normalized[channel].buffer,
				normalized[channel].byteOffset,
				channelBytes,
			), channel * channelBytes);
		}
	} else {
		const target = new DataView(payload);
		for (let channel = 0; channel < normalized.length; channel += 1) {
			const source = new DataView(
				normalized[channel].buffer,
				normalized[channel].byteOffset,
				channelBytes,
			);
			for (let frame = 0; frame < frames; frame += 1) {
				target.setUint32(
					channel * channelBytes + frame * 4,
					source.getUint32(frame * 4, false),
					true,
				);
			}
		}
	}
	return payload;
}

export function unpackPlanarFloat32(payload, frames, channelCount) {
	const buffer = exactArrayBuffer(payload);
	const expectedBytes = pcmRawByteLength(frames, channelCount);
	if (buffer.byteLength !== expectedBytes) {
		throw new PcmStorageCorruptionError(
			`PCM payload has ${buffer.byteLength} bytes; expected ${expectedBytes}.`,
			'PCM_GEOMETRY_MISMATCH',
		);
	}
	const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
	const channels = [];
	if (littleEndian) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			channels.push(new Float32Array(buffer.slice(
				channel * channelBytes,
				(channel + 1) * channelBytes,
			)));
		}
	} else {
		const source = new DataView(buffer);
		for (let channel = 0; channel < channelCount; channel += 1) {
			const output = new Float32Array(frames);
			const outputBits = new Uint32Array(output.buffer);
			for (let frame = 0; frame < frames; frame += 1) {
				outputBits[frame] = source.getUint32(
					channel * channelBytes + frame * 4,
					true,
				);
			}
			channels.push(output);
		}
	}
	return channels;
}

export function minimumWavPackSavings(rawBytes) {
	if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) {
		throw new RangeError('Raw PCM byte length must be a non-negative safe integer.');
	}
	return Math.max(
		WAVPACK_PCM_MINIMUM_SAVINGS_BYTES,
		Math.ceil(rawBytes * WAVPACK_PCM_MINIMUM_SAVINGS_RATIO),
	);
}

export function crc32(input) {
	const bytes = arrayBufferView(input);
	const table = crcTable || (crcTable = createCrcTable());
	let crc = 0xffffffff;
	for (let index = 0; index < bytes.byteLength; index += 1) {
		crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export function exactArrayBuffer(input) {
	if (input instanceof ArrayBuffer) return input;
	if (ArrayBuffer.isView(input)) {
		return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
	}
	throw new TypeError('An ArrayBuffer or typed-array view is required.');
}

export class PcmStorageCorruptionError extends Error {
	constructor(message, code = 'PCM_STORAGE_CORRUPTION', options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'PcmStorageCorruptionError';
		this.code = code;
	}
}

function arrayBufferView(input) {
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	}
	throw new TypeError('An ArrayBuffer or typed-array view is required.');
}

function createCrcTable() {
	return Uint32Array.from({ length: 256 }, (_, value) => {
		let remainder = value;
		for (let bit = 0; bit < 8; bit += 1) {
			remainder = (remainder & 1)
				? 0xedb88320 ^ (remainder >>> 1)
				: remainder >>> 1;
		}
		return remainder >>> 0;
	});
}
