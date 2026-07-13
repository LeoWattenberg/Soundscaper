import { createAiffId3Chunk } from './id3-metadata.js';

const AIFF_VERSION_1 = 0xa2805140;

/**
 * Encodes aligned planar PCM as AIFF (integer) or AIFF-C (32-bit float).
 *
 * @param {ArrayLike<Float32Array> | AudioBuffer} input
 * @param {{sampleRate?: number, bitDepth?: 16|24|32, float?: boolean, sampleFormat?: string, dither?: boolean|string, metadata?: Record<string, *>, random?: () => number}} [options]
 */
export function encodeAiff(input, options = {}) {
	const channels = getChannels(input);
	const frameLength = channels[0]?.length || 0;
	const encoder = createAiffStreamEncoder({
		...options,
		channelCount: channels.length || 1,
		totalFrames: frameLength,
		collect: true,
	});
	encoder.write(channels);
	return encoder.finalize();
}

/**
 * Bounded-memory AIFF/AIFF-C stream encoder. As with the WAV stream encoder,
 * the frame count is declared up front so the file header can be emitted first.
 */
export function createAiffStreamEncoder(options = {}) {
	const sampleRate = positiveInteger(options.sampleRate, 48_000, 'AIFF sample rate');
	const channelCount = integerInRange(options.channelCount, 1, 32, 2, 'AIFF channel count');
	const totalFrames = integerInRange(options.totalFrames, 0, 0xffffffff, 0, 'AIFF frame count');
	const format = normalizeAiffSampleFormat(options);
	const floatingPoint = format === 'float32';
	const bitDepth = Number(format.replace(/\D/g, ''));
	const bytesPerSample = bitDepth / 8;
	const dataBytes = totalFrames * channelCount * bytesPerSample;
	if (!Number.isSafeInteger(dataBytes)) throw new RangeError('AIFF output size exceeds JavaScript integer precision.');
	const padBytes = dataBytes % 2;
	const collect = options.collect ?? !options.onChunk;
	const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
	const dither = floatingPoint ? 'none' : normalizeDither(options.dither);
	const ditherState = new Float64Array(channelCount);
	const random = typeof options.random === 'function' ? options.random : Math.random;
	const metadataChunk = createAiffId3Chunk(options.metadata);
	const header = createAiffHeader({
		sampleRate,
		channelCount,
		totalFrames,
		bitDepth,
		float: floatingPoint,
		trailingByteLength: metadataChunk.byteLength,
	});
	const totalByteLength = header.byteLength + dataBytes + padBytes + metadataChunk.byteLength;
	if (totalByteLength - 8 > 0xffffffff) throw new RangeError('AIFF output cannot exceed its 32-bit FORM size.');
	const chunks = collect ? [header] : [];
	const pending = [];
	let writtenFrames = 0;
	let finalized = false;

	emit(header, { header: true, frameOffset: 0 });

	return {
		get sampleRate() { return sampleRate; },
		get channelCount() { return channelCount; },
		get bitDepth() { return bitDepth; },
		get sampleFormat() { return format; },
		get writtenFrames() { return writtenFrames; },
		get byteLength() { return header.byteLength + writtenFrames * channelCount * bytesPerSample + (finalized ? padBytes + metadataChunk.byteLength : 0); },
		write,
		finalize,
		async settled() { await Promise.all(pending); },
	};

	function write(input) {
		if (finalized) throw new Error('The AIFF encoder has already been finalized.');
		const sourceChannels = getChannels(input);
		if (sourceChannels.length !== channelCount) throw new Error(`Expected ${channelCount} channels, received ${sourceChannels.length}.`);
		const frameLength = sourceChannels[0]?.length || 0;
		if (sourceChannels.some((channel) => channel.length !== frameLength)) throw new Error('All AIFF input channels must contain the same number of frames.');
		if (writtenFrames + frameLength > totalFrames) throw new Error('AIFF input exceeds the declared total frame count.');

		const encoded = new Uint8Array(frameLength * channelCount * bytesPerSample);
		const view = new DataView(encoded.buffer);
		let byteOffset = 0;
		for (let frame = 0; frame < frameLength; frame += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				byteOffset = writeSample(view, byteOffset, sourceChannels[channel][frame], bitDepth, floatingPoint, dither, random, channel, ditherState);
			}
		}
		const frameOffset = writtenFrames;
		writtenFrames += frameLength;
		if (collect) chunks.push(encoded);
		emit(encoded, { header: false, frameOffset });
		return encoded;
	}

	function finalize() {
		if (finalized) throw new Error('The AIFF encoder has already been finalized.');
		if (writtenFrames !== totalFrames) throw new Error(`Expected ${totalFrames} AIFF frames, received ${writtenFrames}.`);
		finalized = true;
		if (padBytes) {
			const padding = new Uint8Array(1);
			if (collect) chunks.push(padding);
			emit(padding, { header: false, frameOffset: writtenFrames });
		}
		if (metadataChunk.byteLength) {
			if (collect) chunks.push(metadataChunk);
			emit(metadataChunk, { header: false, metadata: true, frameOffset: writtenFrames });
		}
		if (!collect) return {
			header,
			byteLength: totalByteLength,
			frames: writtenFrames,
			padBytes,
			...(metadataChunk.byteLength ? { metadataBytes: metadataChunk.byteLength } : {}),
		};
		const result = new Uint8Array(totalByteLength);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return result;
	}

	function emit(chunk, info) {
		if (!onChunk) return;
		const result = onChunk(chunk, info);
		if (result && typeof result.then === 'function') pending.push(Promise.resolve(result));
	}
}

export function createAiffHeader({ sampleRate = 48_000, channelCount = 2, totalFrames = 0, bitDepth = 24, float = false, trailingByteLength = 0 } = {}) {
	const rate = positiveInteger(sampleRate, 48_000, 'AIFF sample rate');
	const channels = integerInRange(channelCount, 1, 32, 2, 'AIFF channel count');
	const frames = integerInRange(totalFrames, 0, 0xffffffff, 0, 'AIFF frame count');
	const depth = float ? 32 : normalizeIntegerBitDepth(bitDepth);
	const dataBytes = frames * channels * (depth / 8);
	if (!Number.isSafeInteger(dataBytes)) throw new RangeError('AIFF output size exceeds JavaScript integer precision.');
	const padBytes = dataBytes % 2;
	const trailingSize = integerInRange(trailingByteLength, 0, 0xffffffff, 0, 'AIFF trailing chunk size');

	const compressionName = float ? pascalString('32-bit floating point') : null;
	const commSize = float ? 18 + 4 + compressionName.byteLength : 18;
	const headerSize = 12 + (float ? 12 : 0) + 8 + commSize + 16;
	const fileSize = headerSize + dataBytes + padBytes + trailingSize;
	if (fileSize - 8 > 0xffffffff) throw new RangeError('AIFF output cannot exceed its 32-bit FORM size.');
	const header = new Uint8Array(headerSize);
	const view = new DataView(header.buffer);
	let offset = 0;

	writeAscii(view, offset, 'FORM'); offset += 4;
	view.setUint32(offset, fileSize - 8, false); offset += 4;
	writeAscii(view, offset, float ? 'AIFC' : 'AIFF'); offset += 4;
	if (float) {
		writeAscii(view, offset, 'FVER'); offset += 4;
		view.setUint32(offset, 4, false); offset += 4;
		view.setUint32(offset, AIFF_VERSION_1, false); offset += 4;
	}
	writeAscii(view, offset, 'COMM'); offset += 4;
	view.setUint32(offset, commSize, false); offset += 4;
	view.setUint16(offset, channels, false); offset += 2;
	view.setUint32(offset, frames, false); offset += 4;
	view.setUint16(offset, depth, false); offset += 2;
	header.set(encodeIeeeExtended80(rate), offset); offset += 10;
	if (float) {
		writeAscii(view, offset, 'fl32'); offset += 4;
		header.set(compressionName, offset); offset += compressionName.byteLength;
	}
	writeAscii(view, offset, 'SSND'); offset += 4;
	view.setUint32(offset, dataBytes + 8, false); offset += 4;
	view.setUint32(offset, 0, false); offset += 4;
	view.setUint32(offset, 0, false);
	return header;
}

/** Encodes a positive sample rate as the 80-bit extended value used by AIFF. */
export function encodeIeeeExtended80(value) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError('AIFF sample rate must be a finite positive number.');
	let exponent = Math.floor(Math.log2(number));
	let mantissa = BigInt(Math.round(number / (2 ** exponent) * (2 ** 31))) << 32n;
	if (mantissa >= (1n << 64n)) {
		mantissa >>= 1n;
		exponent += 1;
	}
	const biasedExponent = exponent + 16_383;
	if (biasedExponent <= 0 || biasedExponent >= 0x7fff) throw new RangeError('AIFF sample rate is outside the extended-float range.');
	const output = new Uint8Array(10);
	const view = new DataView(output.buffer);
	view.setUint16(0, biasedExponent, false);
	view.setUint32(2, Number((mantissa >> 32n) & 0xffffffffn), false);
	view.setUint32(6, Number(mantissa & 0xffffffffn), false);
	return output;
}

function writeSample(view, offset, value, bitDepth, floatingPoint, dither, random, channel, ditherState) {
	if (floatingPoint) {
		view.setFloat32(offset, Number.isFinite(value) ? value : 0, false);
		return offset + 4;
	}
	const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
	const scale = 2 ** (bitDepth - 1);
	const noise = ditherNoise(dither, random, channel, ditherState);
	const quantized = Math.max(-scale, Math.min(scale - 1, Math.round(sample * scale + noise)));
	if (bitDepth === 16) {
		view.setInt16(offset, quantized, false);
		return offset + 2;
	}
	if (bitDepth === 24) {
		view.setUint8(offset, (quantized >> 16) & 0xff);
		view.setUint8(offset + 1, (quantized >> 8) & 0xff);
		view.setUint8(offset + 2, quantized & 0xff);
		return offset + 3;
	}
	view.setInt32(offset, quantized, false);
	return offset + 4;
}

function normalizeDither(value) {
	if (value === false || value === 'none') return 'none';
	if (value === 'triangular-highpass') return value;
	return 'triangular';
}

function ditherNoise(mode, random, channel, state) {
	if (mode === 'none') return 0;
	const current = random() - random();
	if (mode !== 'triangular-highpass') return current;
	const noise = (current - state[channel]) * 0.5;
	state[channel] = current;
	return noise;
}

function normalizeAiffSampleFormat(options) {
	if (options.sampleFormat != null) {
		if (!['int16', 'int24', 'int32', 'float32'].includes(options.sampleFormat)) throw new RangeError(`Unsupported AIFF sample format: ${options.sampleFormat}.`);
		return options.sampleFormat;
	}
	if (options.float) return 'float32';
	return `int${normalizeIntegerBitDepth(options.bitDepth)}`;
}

function normalizeIntegerBitDepth(value) {
	const number = Number(value ?? 24);
	if (![16, 24, 32].includes(number)) throw new RangeError('AIFF bit depth must be 16, 24, or 32.');
	return number;
}

function pascalString(value) {
	const encoded = new TextEncoder().encode(String(value));
	if (encoded.byteLength > 255) throw new RangeError('AIFF Pascal strings cannot exceed 255 bytes.');
	const length = encoded.byteLength + 1;
	const output = new Uint8Array(length + (length % 2));
	output[0] = encoded.byteLength;
	output.set(encoded, 1);
	return output;
}

function getChannels(input) {
	if (input && typeof input.numberOfChannels === 'number' && typeof input.getChannelData === 'function') {
		return Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index));
	}
	if (!input || typeof input.length !== 'number') return [];
	return Array.from(input);
}

function writeAscii(view, offset, value) {
	for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function positiveInteger(value, fallback, name) {
	const number = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer.`);
	return number;
}

function integerInRange(value, minimum, maximum, fallback, name) {
	const number = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	return number;
}
