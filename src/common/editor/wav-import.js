import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MINIMUM_FORMAT_BYTES = 16;
const EXTENSIBLE_FORMAT_BYTES = 40;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const DEFAULT_MAX_RIFF_CHUNKS = 4_096;
const MAX_CHANNEL_COUNT = 64;
const EXTENSIBLE_GUID_TAIL = Object.freeze([
	0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

/**
 * Inspect an uncompressed RIFF/WAVE Blob without materializing its sample data.
 * The returned descriptor can be passed to `streamWavBlobPcm` to avoid parsing
 * the small RIFF header twice.
 */
export async function inspectWavBlobPcm(blob, options = {}) {
	validateBlob(blob);
	const signal = options.signal;
	const maxRiffChunks = positiveIntegerInRange(
		options.maxRiffChunks ?? DEFAULT_MAX_RIFF_CHUNKS,
		1,
		65_536,
		'maxRiffChunks',
	);
	throwIfAborted(signal);
	if (blob.size < RIFF_HEADER_BYTES) throw new Error('The WAV file is too small to contain a RIFF header.');

	const header = await readBlobBytes(blob, 0, RIFF_HEADER_BYTES, signal);
	const headerView = dataView(header);
	if (ascii(header, 0, 4) !== 'RIFF') {
		if (ascii(header, 0, 4) === 'RF64') throw new Error('RF64 WAV files are not supported by the incremental WAV importer.');
		throw new Error('The file is not a RIFF WAV file.');
	}
	if (ascii(header, 8, 4) !== 'WAVE') throw new Error('The RIFF file is not a WAVE file.');
	const riffPayloadBytes = headerView.getUint32(4, true);
	const riffEnd = 8 + riffPayloadBytes;
	if (riffPayloadBytes < 4) throw new Error('The WAV RIFF size is invalid.');
	if (riffEnd > blob.size) throw new Error('The WAV RIFF payload is truncated.');

	let format = null;
	let data = null;
	let offset = RIFF_HEADER_BYTES;
	let chunksRead = 0;
	while (offset < riffEnd && (!format || !data)) {
		throwIfAborted(signal);
		if (chunksRead >= maxRiffChunks) throw new Error(`The WAV file exceeds the ${maxRiffChunks}-chunk inspection limit.`);
		if (riffEnd - offset < CHUNK_HEADER_BYTES) throw new Error('The WAV file ends inside a RIFF chunk header.');
		const chunkHeader = await readBlobBytes(blob, offset, offset + CHUNK_HEADER_BYTES, signal);
		const chunkView = dataView(chunkHeader);
		const chunkId = ascii(chunkHeader, 0, 4);
		const chunkBytes = chunkView.getUint32(4, true);
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		const payloadEnd = payloadOffset + chunkBytes;
		if (payloadEnd > riffEnd || payloadEnd > blob.size) throw new Error(`The WAV ${printableChunkId(chunkId)} chunk is truncated.`);
		chunksRead += 1;

		if (chunkId === 'fmt ' && !format) {
			if (chunkBytes < MINIMUM_FORMAT_BYTES) throw new Error('The WAV format chunk is too small.');
			const bytesToRead = Math.min(chunkBytes, EXTENSIBLE_FORMAT_BYTES);
			const formatBytes = await readBlobBytes(blob, payloadOffset, payloadOffset + bytesToRead, signal);
			format = parseWaveFormat(formatBytes, chunkBytes);
		} else if (chunkId === 'data' && !data) {
			data = { offset: payloadOffset, byteLength: chunkBytes };
		}

		const paddedEnd = payloadEnd + (chunkBytes & 1);
		if (paddedEnd > riffEnd) {
			// A few otherwise valid encoders omit the final RIFF pad byte. It is
			// harmless when both required chunks have already been discovered.
			if (payloadEnd === riffEnd && format && data) break;
			throw new Error(`The WAV ${printableChunkId(chunkId)} chunk is missing its pad byte.`);
		}
		offset = paddedEnd;
	}

	if (!format) throw new Error('The WAV file has no format chunk.');
	if (!data) throw new Error('The WAV file has no data chunk.');
	if (data.byteLength % format.blockAlign !== 0) {
		throw new Error('The WAV data chunk ends inside an interleaved PCM frame.');
	}
	const frameCount = data.byteLength / format.blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('The WAV file contains no complete PCM frames.');

	return Object.freeze({
		container: 'wav',
		encoding: format.encoding,
		sampleFormat: format.sampleFormat,
		formatTag: format.formatTag,
		subFormatTag: format.subFormatTag,
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		frameCount,
		bitDepth: format.bitDepth,
		validBitsPerSample: format.validBitsPerSample,
		bytesPerSample: format.bytesPerSample,
		blockAlign: format.blockAlign,
		byteRate: format.byteRate,
		channelMask: format.channelMask,
		dataOffset: data.offset,
		dataByteLength: data.byteLength,
		riffByteLength: riffEnd,
		sourceByteLength: blob.size,
	});
}

/**
 * Decode an uncompressed WAV Blob into bounded planar Float32 packets.
 * `onChunk` is awaited before another Blob slice is read, providing natural
 * disk-writer backpressure. At most one encoded slice and one decoded packet
 * are retained by this helper, independent of the total file size.
 */
export async function streamWavBlobPcm(blob, options = {}) {
	validateBlob(blob);
	if (typeof options.onChunk !== 'function') throw new TypeError('onChunk must be a function.');
	if (options.onFormat != null && typeof options.onFormat !== 'function') throw new TypeError('onFormat must be a function.');
	const signal = options.signal;
	const chunkFrames = positiveIntegerInRange(
		options.chunkFrames ?? AUDIO_EDITOR_PCM_CHUNK_FRAMES,
		1,
		AUDIO_EDITOR_PCM_CHUNK_FRAMES,
		'chunkFrames',
	);
	const descriptor = options.descriptor == null
		? await inspectWavBlobPcm(blob, options)
		: validateDescriptor(blob, options.descriptor);
	throwIfAborted(signal);
	if (options.onFormat) {
		await options.onFormat(descriptor);
		throwIfAborted(signal);
	}

	let frameOffset = 0;
	let chunkIndex = 0;
	while (frameOffset < descriptor.frameCount) {
		throwIfAborted(signal);
		const frames = Math.min(chunkFrames, descriptor.frameCount - frameOffset);
		const byteOffset = descriptor.dataOffset + frameOffset * descriptor.blockAlign;
		const encoded = await readBlobBytes(blob, byteOffset, byteOffset + frames * descriptor.blockAlign, signal);
		const channels = decodeInterleavedPcm(encoded, frames, descriptor);
		await options.onChunk(channels, Object.freeze({
			index: chunkIndex,
			frameOffset,
			frames,
			final: frameOffset + frames === descriptor.frameCount,
			descriptor,
			signal,
		}));
		throwIfAborted(signal);
		frameOffset += frames;
		chunkIndex += 1;
	}

	return Object.freeze({ ...descriptor, chunkFrames, chunkCount: chunkIndex });
}

function parseWaveFormat(bytes, declaredBytes) {
	const view = dataView(bytes);
	const formatTag = view.getUint16(0, true);
	const channelCount = view.getUint16(2, true);
	const sampleRate = view.getUint32(4, true);
	const byteRate = view.getUint32(8, true);
	const blockAlign = view.getUint16(12, true);
	const bitDepth = view.getUint16(14, true);
	if (channelCount < 1 || channelCount > MAX_CHANNEL_COUNT) {
		throw new RangeError(`WAV channel count must be between 1 and ${MAX_CHANNEL_COUNT}.`);
	}
	if (!sampleRate) throw new RangeError('WAV sample rate must be positive.');

	let subFormatTag = formatTag;
	let validBitsPerSample = bitDepth;
	let channelMask = 0;
	if (formatTag === WAVE_FORMAT_EXTENSIBLE) {
		if (declaredBytes < EXTENSIBLE_FORMAT_BYTES || bytes.byteLength < EXTENSIBLE_FORMAT_BYTES) {
			throw new Error('The extensible WAV format chunk is too small.');
		}
		const extensionBytes = view.getUint16(16, true);
		if (extensionBytes < 22) throw new Error('The extensible WAV format payload is incomplete.');
		validBitsPerSample = view.getUint16(18, true);
		channelMask = view.getUint32(20, true);
		subFormatTag = view.getUint32(24, true);
		for (let index = 0; index < EXTENSIBLE_GUID_TAIL.length; index += 1) {
			if (view.getUint8(28 + index) !== EXTENSIBLE_GUID_TAIL[index]) {
				throw new Error('The extensible WAV subformat GUID is unsupported.');
			}
		}
	}

	const encoding = subFormatTag === WAVE_FORMAT_PCM
		? 'pcm-integer'
		: subFormatTag === WAVE_FORMAT_IEEE_FLOAT ? 'ieee-float' : null;
	if (!encoding) throw new Error(`WAV format ${subFormatTag} is compressed or unsupported.`);
	const integerDepth = bitDepth === 8 || bitDepth === 16 || bitDepth === 24 || bitDepth === 32;
	const floatDepth = bitDepth === 32 || bitDepth === 64;
	if ((encoding === 'pcm-integer' && !integerDepth) || (encoding === 'ieee-float' && !floatDepth)) {
		throw new Error(`${encoding === 'ieee-float' ? 'IEEE float' : 'Integer PCM'} WAV bit depth ${bitDepth} is unsupported.`);
	}
	if (validBitsPerSample < 1 || validBitsPerSample > bitDepth) {
		throw new Error('The WAV valid-bits field is outside its sample container.');
	}
	if (encoding === 'ieee-float' && validBitsPerSample !== bitDepth) {
		throw new Error('IEEE float WAV samples must use their full container width.');
	}
	const bytesPerSample = bitDepth / 8;
	const expectedBlockAlign = channelCount * bytesPerSample;
	if (blockAlign !== expectedBlockAlign) {
		throw new Error(`WAV block alignment must be ${expectedBlockAlign} bytes for this format.`);
	}
	const expectedByteRate = sampleRate * blockAlign;
	if (byteRate !== expectedByteRate) throw new Error(`WAV byte rate must be ${expectedByteRate}.`);

	return {
		formatTag,
		subFormatTag,
		encoding,
		sampleFormat: encoding === 'ieee-float' ? `float${bitDepth}` : bitDepth === 8 ? 'uint8' : `int${bitDepth}`,
		sampleRate,
		channelCount,
		bitDepth,
		validBitsPerSample,
		bytesPerSample,
		blockAlign,
		byteRate,
		channelMask,
	};
}

function decodeInterleavedPcm(bytes, frameCount, descriptor) {
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(frameCount));
	const view = dataView(bytes);
	let byteOffset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < descriptor.channelCount; channel += 1) {
			channels[channel][frame] = readPcmSample(view, byteOffset, descriptor.sampleFormat);
			byteOffset += descriptor.bytesPerSample;
		}
	}
	return channels;
}

function readPcmSample(view, offset, sampleFormat) {
	if (sampleFormat === 'uint8') return (view.getUint8(offset) - 128) / 128;
	if (sampleFormat === 'int16') return view.getInt16(offset, true) / 0x8000;
	if (sampleFormat === 'int24') {
		let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
		if (value & 0x800000) value |= 0xff000000;
		return value / 0x800000;
	}
	if (sampleFormat === 'int32') return view.getInt32(offset, true) / 0x80000000;
	const value = sampleFormat === 'float32' ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
	return Number.isFinite(value) ? value : 0;
}

function validateDescriptor(blob, descriptor) {
	if (!descriptor || typeof descriptor !== 'object' || descriptor.container !== 'wav') {
		throw new TypeError('A WAV PCM descriptor is required.');
	}
	if (descriptor.sourceByteLength !== blob.size) throw new Error('The WAV descriptor belongs to a different-sized Blob.');
	const integerFields = [
		'sampleRate', 'channelCount', 'frameCount', 'bitDepth', 'validBitsPerSample', 'bytesPerSample',
		'blockAlign', 'byteRate', 'dataOffset', 'dataByteLength', 'riffByteLength', 'sourceByteLength',
	];
	for (const field of integerFields) {
		if (!Number.isSafeInteger(descriptor[field]) || descriptor[field] < 0) throw new TypeError(`WAV descriptor ${field} is invalid.`);
	}
	for (const field of ['formatTag', 'subFormatTag', 'channelMask']) {
		if (!Number.isInteger(descriptor[field]) || descriptor[field] < 0 || descriptor[field] > 0xffffffff) {
			throw new TypeError(`WAV descriptor ${field} is invalid.`);
		}
	}
	if (descriptor.sampleRate < 1 || descriptor.channelCount < 1
		|| descriptor.channelCount > MAX_CHANNEL_COUNT || descriptor.frameCount < 1) {
		throw new TypeError('WAV descriptor PCM geometry is invalid.');
	}
	const formats = {
		uint8: { bitDepth: 8, bytesPerSample: 1, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
		int16: { bitDepth: 16, bytesPerSample: 2, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
		int24: { bitDepth: 24, bytesPerSample: 3, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
		int32: { bitDepth: 32, bytesPerSample: 4, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
		float32: { bitDepth: 32, bytesPerSample: 4, encoding: 'ieee-float', subFormatTag: WAVE_FORMAT_IEEE_FLOAT },
		float64: { bitDepth: 64, bytesPerSample: 8, encoding: 'ieee-float', subFormatTag: WAVE_FORMAT_IEEE_FLOAT },
	};
	const format = formats[descriptor.sampleFormat];
	if (!format || descriptor.bitDepth !== format.bitDepth || descriptor.bytesPerSample !== format.bytesPerSample
		|| descriptor.encoding !== format.encoding || descriptor.subFormatTag !== format.subFormatTag
		|| (descriptor.formatTag !== format.subFormatTag && descriptor.formatTag !== WAVE_FORMAT_EXTENSIBLE)) {
		throw new TypeError('WAV descriptor sample format is invalid.');
	}
	if (descriptor.validBitsPerSample < 1 || descriptor.validBitsPerSample > descriptor.bitDepth
		|| (descriptor.encoding === 'ieee-float' && descriptor.validBitsPerSample !== descriptor.bitDepth)) {
		throw new TypeError('WAV descriptor valid-bits field is invalid.');
	}
	const expectedBlockAlign = descriptor.channelCount * descriptor.bytesPerSample;
	const expectedDataBytes = descriptor.frameCount * descriptor.blockAlign;
	const dataEnd = descriptor.dataOffset + descriptor.dataByteLength;
	if (descriptor.blockAlign !== expectedBlockAlign || descriptor.byteRate !== descriptor.sampleRate * descriptor.blockAlign
		|| descriptor.dataOffset < RIFF_HEADER_BYTES || !Number.isSafeInteger(expectedDataBytes)
		|| !Number.isSafeInteger(dataEnd) || expectedDataBytes !== descriptor.dataByteLength
		|| dataEnd > descriptor.riffByteLength || descriptor.riffByteLength > blob.size) {
		throw new TypeError('WAV descriptor data range is invalid.');
	}
	return descriptor;
}

async function readBlobBytes(blob, start, end, signal) {
	throwIfAborted(signal);
	const part = blob.slice(start, end);
	if (!part || typeof part.arrayBuffer !== 'function') throw new TypeError('Blob slices must provide arrayBuffer().');
	const buffer = await part.arrayBuffer();
	throwIfAborted(signal);
	if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Blob arrayBuffer() must return an ArrayBuffer.');
	const expectedBytes = end - start;
	if (buffer.byteLength !== expectedBytes) throw new Error('A WAV Blob slice returned an unexpected number of bytes.');
	return new Uint8Array(buffer);
}

function validateBlob(blob) {
	if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.slice !== 'function') {
		throw new TypeError('A Blob or File with size and slice() is required.');
	}
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	if (signal.reason?.name === 'AbortError') throw signal.reason;
	const message = typeof signal.reason === 'string'
		? signal.reason
		: signal.reason?.message || 'Incremental WAV decoding was aborted.';
	if (typeof DOMException === 'function') throw new DOMException(message, 'AbortError');
	const error = new Error(message);
	error.name = 'AbortError';
	throw error;
}

function positiveIntegerInRange(value, minimum, maximum, name) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value;
}

function dataView(bytes) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes, offset, length) {
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
	return value;
}

function printableChunkId(value) {
	return JSON.stringify(value.replace(/[^\x20-\x7e]/g, '?'));
}
