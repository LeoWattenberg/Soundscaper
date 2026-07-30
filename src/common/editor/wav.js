import { createRiffId3Chunk } from './id3-metadata.js';
import { createRiffBextChunk } from './broadcast-wave.ts';
import { createRiffMarkerChunks } from './riff-markers.ts';
import { createRiffInfoChunk } from './riff-info.ts';
import { createRiffIxmlChunk } from './ixml.ts';
import { createRiffCartChunk } from './cart-metadata.ts';

const UINT32_MAX = 0xffff_ffff;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Encode channel-aligned PCM samples as a complete WAV file.
 *
 * @param {ArrayLike<Float32Array> | AudioBuffer} input
 * @param {{ container?: 'auto' | 'bw64', sampleRate?: number, bitDepth?: 16 | 20 | 24 | 32, float?: boolean, dither?: boolean|string, metadata?: Record<string, *>, markers?: readonly import('./riff-markers.ts').RiffMarkerInput[], ixml?: import('./ixml.ts').IxmlMetadataInput|null, cart?: import('./cart-metadata.ts').CartMetadataInput|null, bext?: import('./broadcast-wave.ts').BextMetadataInput, preDataChunks?: Uint8Array | readonly Uint8Array[], trailingChunks?: Uint8Array | readonly Uint8Array[], channelMask?: number, random?: () => number }} [options]
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
 * A declared `totalFrames` lets the RIFF, RF64, or BW64 header be written before the PCM.
 *
 * @param {{
 *   container?: 'auto' | 'bw64',
 *   sampleRate?: number,
 *   channelCount?: number,
 *   totalFrames: number,
 *   bitDepth?: 16 | 20 | 24 | 32,
 *   float?: boolean,
 *   dither?: boolean | 'none' | 'triangular' | 'triangular-highpass',
 *   metadata?: Record<string, *>,
 *   markers?: readonly import('./riff-markers.ts').RiffMarkerInput[],
 *   ixml?: import('./ixml.ts').IxmlMetadataInput | null,
 *   cart?: import('./cart-metadata.ts').CartMetadataInput | null,
 *   bext?: import('./broadcast-wave.ts').BextMetadataInput,
 *   preDataChunks?: Uint8Array | readonly Uint8Array[],
 *   trailingChunks?: Uint8Array | readonly Uint8Array[],
 *   channelMask?: number,
 *   random?: () => number,
 *   collect?: boolean,
 *   onChunk?: (chunk: Uint8Array, info: { header: boolean, frameOffset: number, metadata?: boolean, padding?: boolean }) => void | Promise<void>,
 * }} options
 */
export function createWavStreamEncoder(options) {
	validateBw64Options(options);
	const sampleRate = positiveInteger(options?.sampleRate, 48000);
	const channelCount = positiveInteger(options?.channelCount, 2);
	const totalFrames = nonNegativeSafeInteger(options?.totalFrames, 0, 'totalFrames');
	const float = Boolean(options?.float);
	const bitDepth = float ? 32 : normalizeBitDepth(options?.bitDepth);
	const bytesPerSample = Math.ceil(bitDepth / 8);
	const collect = options?.collect ?? !options?.onChunk;
	const onChunk = typeof options?.onChunk === 'function' ? options.onChunk : null;
	const dither = float ? 'none' : normalizeDither(options?.dither);
	const ditherState = new Float64Array(channelCount);
	const random = typeof options?.random === 'function' ? options.random : Math.random;
	const metadataChunk = concatBytes(
		createRiffMarkerChunks(options?.markers),
		createRiffIxmlChunk(options?.ixml),
		createRiffCartChunk(options?.cart),
		createRiffId3Chunk(options?.metadata),
		createRiffInfoChunk(options?.metadata),
	);
	const callerTrailingChunk = normalizeRiffChunks(options?.trailingChunks, 'trailingChunks');
	const layout = prepareWavLayout({
		sampleRate,
		channelCount,
		totalFrames,
		bitDepth,
		float,
		container: options?.container,
		preDataChunks: options?.preDataChunks,
		trailingByteLength: callerTrailingChunk.byteLength + metadataChunk.byteLength,
		bext: options?.bext,
	});
	if (layout.container === 'rf64' && collect) {
		throw new Error('RF64 output requires streaming with collect: false.');
	}
	const header = createWavHeaderFromLayout(layout);
	const dataPadBytes = layout.dataPadByteLength;
	const totalByteLength = layout.byteLength;
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
		get byteLength() { return header.byteLength + writtenFrames * channelCount * bytesPerSample + (finalized ? dataPadBytes + callerTrailingChunk.byteLength + metadataChunk.byteLength : 0); },
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
		if (dataPadBytes) {
			const padding = new Uint8Array(dataPadBytes);
			if (collect) chunks.push(padding);
			emit(padding, { header: false, padding: true, frameOffset: writtenFrames });
		}
		if (callerTrailingChunk.byteLength) {
			if (collect) chunks.push(callerTrailingChunk);
			emit(callerTrailingChunk, { header: false, metadata: true, frameOffset: writtenFrames });
		}
		if (metadataChunk.byteLength) {
			if (collect) chunks.push(metadataChunk);
			emit(metadataChunk, { header: false, metadata: true, frameOffset: writtenFrames });
		}
		if (!collect) {
			return {
				header,
				byteLength: totalByteLength,
				frames: writtenFrames,
				...(callerTrailingChunk.byteLength + metadataChunk.byteLength
					? { metadataBytes: callerTrailingChunk.byteLength + metadataChunk.byteLength }
					: {}),
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

/**
 * Inspect the exact on-disk WAV layout without allocating PCM or file-sized buffers.
 * An explicit `trailingByteLength` takes precedence over the encoded `metadata` size.
 *
 * @param {{ container?: 'auto' | 'bw64', sampleRate?: number, channelCount?: number, totalFrames?: number, bitDepth?: 16 | 20 | 24 | 32, float?: boolean, preDataChunks?: Uint8Array | readonly Uint8Array[], trailingChunks?: Uint8Array | readonly Uint8Array[], trailingByteLength?: number, metadata?: Record<string, *>, markers?: readonly import('./riff-markers.ts').RiffMarkerInput[], ixml?: import('./ixml.ts').IxmlMetadataInput|null, cart?: import('./cart-metadata.ts').CartMetadataInput|null, bext?: import('./broadcast-wave.ts').BextMetadataInput, channelMask?: number }} [options]
 * @returns {{ container: 'riff' | 'rf64' | 'bw64', byteLength: number, headerByteLength: number, riffSize: number, dataByteLength: number, dataPadByteLength: number, trailingByteLength: number, bextByteLength: number }}
 */
export function inspectWavLayout(options = {}) {
	const layout = prepareWavLayout(options);
	return Object.freeze({
		container: layout.container,
		byteLength: layout.byteLength,
		headerByteLength: layout.headerByteLength,
		riffSize: layout.riffSize,
		dataByteLength: layout.dataByteLength,
		dataPadByteLength: layout.dataPadByteLength,
		trailingByteLength: layout.trailingByteLength,
		bextByteLength: layout.bextByteLength,
	});
}

export function createWavHeader(options = {}) {
	return createWavHeaderFromLayout(prepareWavLayout(options));
}

function prepareWavLayout({
	container: requestedContainer = 'auto', sampleRate = 48000, channelCount = 2,
	totalFrames = 0, bitDepth = 24, float = false, preDataChunks, trailingChunks,
	trailingByteLength, metadata, markers, ixml, cart, bext = null, channelMask,
} = {}) {
	const requested = normalizeWavContainer(requestedContainer);
	validateBw64Options({ container: requested, channelCount, bitDepth, float });
	const normalizedRate = positiveInteger(sampleRate, 48000);
	const normalizedChannels = positiveInteger(channelCount, 2);
	const normalizedDepth = float ? 32 : normalizeBitDepth(bitDepth);
	const broadcast = bext != null;
	if (broadcast && (float || ![16, 20, 24].includes(normalizedDepth))) {
		throw new RangeError('Broadcast WAV supports only 16-bit, 20-bit, or 24-bit integer PCM.');
	}
	if (broadcast && normalizedChannels > 32) throw new RangeError('Broadcast WAV supports at most 32 channels.');
	const bytesPerSample = Math.ceil(normalizedDepth / 8);
	if (!Number.isSafeInteger(normalizedRate) || normalizedRate > UINT32_MAX) {
		throw new RangeError('WAV sampleRate must fit the unsigned 32-bit format field.');
	}
	if (!Number.isSafeInteger(normalizedChannels) || normalizedChannels > 0xffff) {
		throw new RangeError('WAV channelCount must fit the unsigned 16-bit format field.');
	}
	const blockAlign = normalizedChannels * bytesPerSample;
	if (blockAlign > 0xffff) {
		throw new RangeError('WAV block alignment must fit the unsigned 16-bit format field.');
	}
	const byteRate = safeIntegerFromBigInt(
		BigInt(normalizedRate) * BigInt(blockAlign),
		'WAV byte rate',
	);
	if (byteRate > UINT32_MAX) {
		throw new RangeError('WAV byte rate must fit the unsigned 32-bit format field.');
	}
	const normalizedFrames = nonNegativeSafeInteger(totalFrames, 0, 'totalFrames');
	const dataSize = safeIntegerFromBigInt(
		BigInt(normalizedFrames) * BigInt(normalizedChannels) * BigInt(bytesPerSample),
		'WAV output size',
	);
	const preDataChunk = normalizeRiffChunks(preDataChunks, 'preDataChunks');
	const callerTrailingChunk = normalizeRiffChunks(trailingChunks, 'trailingChunks');
	const trailingSize = trailingByteLength == null
		? callerTrailingChunk.byteLength + createRiffMarkerChunks(markers).byteLength + createRiffIxmlChunk(ixml).byteLength + createRiffCartChunk(cart).byteLength + createRiffId3Chunk(metadata).byteLength + createRiffInfoChunk(metadata).byteLength
		: nonNegativeSafeInteger(trailingByteLength, 0, 'trailingByteLength');
	const bextChunk = broadcast ? createRiffBextChunk(bext) : new Uint8Array(0);
	const classicDataPadSize = broadcast || requested === 'bw64' ? dataSize & 1 : 0;
	const classicRiffSize = 36n
		+ BigInt(bextChunk.byteLength)
		+ BigInt(preDataChunk.byteLength)
		+ BigInt(dataSize)
		+ BigInt(classicDataPadSize)
		+ BigInt(trailingSize);
	const container = requested === 'bw64'
		? 'bw64'
		: classicRiffSize <= BigInt(UINT32_MAX) ? 'riff' : 'rf64';
	const dataPadSize = container === 'riff' ? classicDataPadSize : dataSize & 1;
	const extensible = broadcast && normalizedChannels > 2 && container !== 'bw64';
	const formatChunkByteLength = extensible ? 48 : 24;
	const headerByteLength = 12 + (container === 'riff' ? 0 : 36)
		+ bextChunk.byteLength + formatChunkByteLength + preDataChunk.byteLength + 8;
	const byteLength = safeIntegerFromBigInt(
		BigInt(headerByteLength) + BigInt(dataSize) + BigInt(dataPadSize) + BigInt(trailingSize),
		'WAV output size',
	);
	return {
		container,
		byteLength,
		headerByteLength,
		riffSize: byteLength - 8,
		dataByteLength: dataSize,
		dataPadByteLength: dataPadSize,
		trailingByteLength: trailingSize,
		bextByteLength: bextChunk.byteLength,
		bextChunk,
		preDataChunk,
		sampleRate: normalizedRate,
		channelCount: normalizedChannels,
		totalFrames: normalizedFrames,
		bitDepth: normalizedDepth,
		float: Boolean(float),
		bytesPerSample,
		blockAlign,
		byteRate,
		extensible,
		formatChunkByteLength,
		channelMask: normalizeChannelMask(channelMask, normalizedChannels),
	};
}

function concatBytes(...parts) {
	const output = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

function createWavHeaderFromLayout(layout) {
	const header = new Uint8Array(layout.headerByteLength);
	const view = new DataView(header.buffer);
	writeAscii(view, 0, layout.container === 'bw64' ? 'BW64' : layout.container === 'rf64' ? 'RF64' : 'RIFF');
	view.setUint32(4, layout.container === 'riff' ? layout.riffSize : UINT32_MAX, true);
	writeAscii(view, 8, 'WAVE');
	let chunkOffset = 12;
	if (layout.container !== 'riff') {
		writeAscii(view, chunkOffset, 'ds64');
		view.setUint32(chunkOffset + 4, 28, true);
		view.setBigUint64(chunkOffset + 8, BigInt(layout.riffSize), true);
		view.setBigUint64(chunkOffset + 16, BigInt(layout.dataByteLength), true);
		view.setBigUint64(chunkOffset + 24, layout.container === 'bw64' ? 0n : BigInt(layout.totalFrames), true);
		view.setUint32(chunkOffset + 32, 0, true);
		chunkOffset += 36;
	}
	header.set(layout.bextChunk, chunkOffset);
	const formatOffset = chunkOffset + layout.bextByteLength;
	writeAscii(view, formatOffset, 'fmt ');
	view.setUint32(formatOffset + 4, layout.extensible ? 40 : 16, true);
	view.setUint16(formatOffset + 8, layout.extensible ? 0xfffe : layout.float ? 3 : 1, true);
	view.setUint16(formatOffset + 10, layout.channelCount, true);
	view.setUint32(formatOffset + 12, layout.sampleRate, true);
	view.setUint32(formatOffset + 16, layout.byteRate, true);
	view.setUint16(formatOffset + 20, layout.blockAlign, true);
	view.setUint16(formatOffset + 22, layout.bitDepth, true);
	if (layout.extensible) {
		view.setUint16(formatOffset + 24, 22, true);
		view.setUint16(formatOffset + 26, layout.bitDepth, true);
		view.setUint32(formatOffset + 28, layout.channelMask, true);
		view.setUint32(formatOffset + 32, 1, true);
		const guidTail = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
		for (let index = 0; index < guidTail.length; index += 1) view.setUint8(formatOffset + 36 + index, guidTail[index]);
	}
	const preDataOffset = formatOffset + layout.formatChunkByteLength;
	header.set(layout.preDataChunk, preDataOffset);
	const dataOffset = preDataOffset + layout.preDataChunk.byteLength;
	writeAscii(view, dataOffset, 'data');
	view.setUint32(dataOffset + 4, layout.container === 'riff' ? layout.dataByteLength : UINT32_MAX, true);
	return header;
}

function normalizeWavContainer(value) {
	if (value === 'auto' || value === 'bw64') return value;
	throw new RangeError('WAV container must be "auto" or "bw64".');
}

function validateBw64Options({ container, channelCount = 2, bitDepth = 24, float = false } = {}) {
	if (container !== 'bw64') return;
	if (float) throw new RangeError('BW64 supports only integer PCM.');
	if (![16, 20, 24].includes(bitDepth)) throw new RangeError('BW64 supports only 16-bit, 20-bit, or 24-bit integer PCM.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('BW64 supports an integer channel count from 1 through 32 channels.');
	}
}

function normalizeRiffChunks(value, name) {
	if (value == null) return new Uint8Array(0);
	const chunks = value instanceof Uint8Array ? [value] : Array.isArray(value) ? value : null;
	if (!chunks) throw new TypeError(`${name} must contain complete RIFF chunk bytes.`);
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength < 8) {
			throw new TypeError(`${name} must contain complete RIFF chunk bytes.`);
		}
		const id = String.fromCharCode(...chunk.subarray(0, 4));
		if (id === 'RIFF' || id === 'RF64' || id === 'BW64' || id === 'ds64' || id === 'fmt ' || id === 'data') {
			throw new RangeError(`${name} cannot contain the structural RIFF chunk ${JSON.stringify(id)}.`);
		}
		const payloadBytes = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
		if (8 + payloadBytes + (payloadBytes & 1) !== chunk.byteLength) {
			throw new RangeError(`${name} RIFF chunk ${JSON.stringify(id)} has an inconsistent size.`);
		}
	}
	return concatBytes(...chunks);
}

function normalizeChannelMask(value, channelCount) {
	if (value == null) return channelCount === 32 ? UINT32_MAX : (2 ** channelCount - 1) >>> 0;
	if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new RangeError('WAV channelMask must be an unsigned 32-bit integer.');
	return value;
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
	const packed = bitDepth === 20 ? quantized * 16 : quantized;
	view.setUint8(byteOffset, packed & 0xff);
	view.setUint8(byteOffset + 1, (packed >> 8) & 0xff);
	view.setUint8(byteOffset + 2, (packed >> 16) & 0xff);
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
	return value === 16 || value === 20 || value === 32 ? value : 24;
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeSafeInteger(value, fallback, name) {
	const candidate = value ?? fallback;
	if (!Number.isSafeInteger(candidate) || candidate < 0) {
		throw new RangeError(`WAV ${name} must be a non-negative safe integer.`);
	}
	return candidate;
}

function safeIntegerFromBigInt(value, name) {
	if (value < 0n || value > MAX_SAFE_INTEGER_BIGINT) {
		throw new RangeError(`${name} exceeds JavaScript's safe integer range.`);
	}
	return Number(value);
}

function clampSample(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-1, Math.min(1, value));
}

function finiteSample(value) {
	return Number.isFinite(value) ? value : 0;
}
