import { createRiffId3Chunk } from './id3-metadata.js';

const WAV_HEADER_BYTES = 44;

/**
 * Encode channel-aligned PCM samples as a complete WAV file.
 *
 * @param {ArrayLike<Float32Array> | AudioBuffer} input
 * @param {{ sampleRate?: number, bitDepth?: 16 | 24 | 32, float?: boolean, dither?: boolean|string, metadata?: Record<string, *>, random?: () => number }} [options]
 * @returns {Uint8Array}
 */
export function encodeWav(input, options = {}) {
	const channels = getChannels(input);
	const frameLength = channels[0]?.length || 0;
	const encoder = createWavStreamEncoder({
		...options,
		channelCount: channels.length || 1,
		totalFrames: frameLength,
		collect: true,
	});
	encoder.write(channels);
	return encoder.finalize();
}

/**
 * Creates a bounded-memory WAV encoder. When `onChunk` is supplied, encoded
 * bytes are emitted as they are produced and `finalize()` returns metadata.
 * A declared `totalFrames` lets the 44-byte header be written before the PCM.
 *
 * @param {{
 *   sampleRate?: number,
 *   channelCount?: number,
 *   totalFrames: number,
 *   bitDepth?: 16 | 24 | 32,
 *   float?: boolean,
 *   dither?: boolean | 'none' | 'triangular' | 'triangular-highpass',
 *   metadata?: Record<string, *>,
 *   random?: () => number,
 *   collect?: boolean,
 *   onChunk?: (chunk: Uint8Array, info: { header: boolean, frameOffset: number }) => void | Promise<void>,
 * }} options
 */
export function createWavStreamEncoder(options) {
	const sampleRate = positiveInteger(options?.sampleRate, 48000);
	const channelCount = positiveInteger(options?.channelCount, 2);
	const totalFrames = nonNegativeInteger(options?.totalFrames, 0);
	const float = Boolean(options?.float);
	const bitDepth = float ? 32 : normalizeBitDepth(options?.bitDepth);
	const bytesPerSample = bitDepth / 8;
	const collect = options?.collect ?? !options?.onChunk;
	const onChunk = typeof options?.onChunk === 'function' ? options.onChunk : null;
	const dither = float ? 'none' : normalizeDither(options?.dither);
	const ditherState = new Float64Array(channelCount);
	const random = typeof options?.random === 'function' ? options.random : Math.random;
	const metadataChunk = createRiffId3Chunk(options?.metadata);
	const header = createWavHeader({ sampleRate, channelCount, totalFrames, bitDepth, float, trailingByteLength: metadataChunk.byteLength });
	const totalByteLength = WAV_HEADER_BYTES + totalFrames * channelCount * bytesPerSample + metadataChunk.byteLength;
	/** @type {Uint8Array[]} */
	const chunks = collect ? [header] : [];
	/** @type {Promise<void>[]} */
	const pending = [];
	let writtenFrames = 0;
	let finalized = false;

	emit(header, { header: true, frameOffset: 0 });

	return {
		get sampleRate() { return sampleRate; },
		get channelCount() { return channelCount; },
		get bitDepth() { return bitDepth; },
		get writtenFrames() { return writtenFrames; },
		get byteLength() { return WAV_HEADER_BYTES + writtenFrames * channelCount * bytesPerSample + (finalized ? metadataChunk.byteLength : 0); },
		write,
		finalize,
		async settled() { await Promise.all(pending); },
	};

	/** @param {ArrayLike<Float32Array> | AudioBuffer} input */
	function write(input) {
		if (finalized) throw new Error('The WAV encoder has already been finalized.');
		const sourceChannels = getChannels(input);
		if (sourceChannels.length !== channelCount) {
			throw new Error(`Expected ${channelCount} channels, received ${sourceChannels.length}.`);
		}

		const frameLength = sourceChannels[0]?.length || 0;
		if (sourceChannels.some((channel) => channel.length !== frameLength)) {
			throw new Error('All WAV input channels must contain the same number of frames.');
		}
		if (writtenFrames + frameLength > totalFrames) {
			throw new Error('WAV input exceeds the declared total frame count.');
		}

		const encoded = new Uint8Array(frameLength * channelCount * bytesPerSample);
		const view = new DataView(encoded.buffer);
		let byteOffset = 0;
		for (let frame = 0; frame < frameLength; frame += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				const original = sourceChannels[channel][frame];
				const sample = float ? finiteSample(original) : clampSample(original);
				byteOffset = writeSample(view, byteOffset, sample, bitDepth, float, dither, random, channel, ditherState);
			}
		}

		const frameOffset = writtenFrames;
		writtenFrames += frameLength;
		if (collect) chunks.push(encoded);
		emit(encoded, { header: false, frameOffset });
		return encoded;
	}

	function finalize() {
		if (finalized) {
			throw new Error('The WAV encoder has already been finalized.');
		}
		if (writtenFrames !== totalFrames) {
			throw new Error(`Expected ${totalFrames} WAV frames, received ${writtenFrames}.`);
		}
		finalized = true;
		if (metadataChunk.byteLength) {
			if (collect) chunks.push(metadataChunk);
			emit(metadataChunk, { header: false, metadata: true, frameOffset: writtenFrames });
		}
		if (!collect) {
			return {
				header,
				byteLength: totalByteLength,
				frames: writtenFrames,
				...(metadataChunk.byteLength ? { metadataBytes: metadataChunk.byteLength } : {}),
			};
		}

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
		if (result && typeof result.then === 'function') {
			pending.push(Promise.resolve(result));
		}
	}
}

export function createWavHeader({ sampleRate = 48000, channelCount = 2, totalFrames = 0, bitDepth = 24, float = false, trailingByteLength = 0 } = {}) {
	const normalizedRate = positiveInteger(sampleRate, 48000);
	const normalizedChannels = positiveInteger(channelCount, 2);
	const normalizedDepth = float ? 32 : normalizeBitDepth(bitDepth);
	const bytesPerSample = normalizedDepth / 8;
	const dataSize = nonNegativeInteger(totalFrames, 0) * normalizedChannels * bytesPerSample;
	const trailingSize = nonNegativeInteger(trailingByteLength, 0);
	if (dataSize + trailingSize > 0xffffffff - 36) {
		throw new Error('Classic WAV output cannot exceed 4 GiB.');
	}

	const header = new Uint8Array(WAV_HEADER_BYTES);
	const view = new DataView(header.buffer);
	writeAscii(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataSize + trailingSize, true);
	writeAscii(view, 8, 'WAVE');
	writeAscii(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, float ? 3 : 1, true);
	view.setUint16(22, normalizedChannels, true);
	view.setUint32(24, normalizedRate, true);
	view.setUint32(28, normalizedRate * normalizedChannels * bytesPerSample, true);
	view.setUint16(32, normalizedChannels * bytesPerSample, true);
	view.setUint16(34, normalizedDepth, true);
	writeAscii(view, 36, 'data');
	view.setUint32(40, dataSize, true);
	return header;
}

function getChannels(input) {
	if (input && typeof input.numberOfChannels === 'number' && typeof input.getChannelData === 'function') {
		return Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index));
	}
	if (!input || typeof input.length !== 'number') return [];
	return Array.from(input);
}

function writeSample(view, byteOffset, original, bitDepth, float, dither, random, channel, ditherState) {
	if (float) {
		view.setFloat32(byteOffset, original, true);
		return byteOffset + 4;
	}

	const scale = 2 ** (bitDepth - 1);
	const noise = ditherNoise(dither, random, channel, ditherState);
	const quantized = Math.max(-scale, Math.min(scale - 1, Math.round(original * scale + noise)));
	if (bitDepth === 16) {
		view.setInt16(byteOffset, quantized, true);
		return byteOffset + 2;
	}
	if (bitDepth === 32) {
		view.setInt32(byteOffset, quantized, true);
		return byteOffset + 4;
	}
	view.setUint8(byteOffset, quantized & 0xff);
	view.setUint8(byteOffset + 1, (quantized >> 8) & 0xff);
	view.setUint8(byteOffset + 2, (quantized >> 16) & 0xff);
	return byteOffset + 3;
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

function writeAscii(view, offset, value) {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}

function normalizeBitDepth(value) {
	return value === 16 || value === 32 ? value : 24;
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function clampSample(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-1, Math.min(1, value));
}

function finiteSample(value) {
	return Number.isFinite(value) ? value : 0;
}
