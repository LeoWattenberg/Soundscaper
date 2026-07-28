import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';
import { BEXT_MAX_PAYLOAD_BYTES, normalizeBextMetadata, parseBextPayload } from './broadcast-wave.ts';
import { parseRiffMarkers } from './riff-markers.ts';
import { parseRiffInfo } from './riff-info.ts';

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MINIMUM_FORMAT_BYTES = 16;
const EXTENSIBLE_FORMAT_BYTES = 40;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const DEFAULT_MAX_RIFF_CHUNKS = 4_096;
const MAX_CHANNEL_COUNT = 64;
const UINT32_SENTINEL = 0xffff_ffff;
const DS64_MINIMUM_BYTES = 28;
const DS64_TABLE_ENTRY_BYTES = 12;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_RIFF_METADATA_BYTES = 16 * 1024 * 1024;
const EXTENSIBLE_GUID_TAIL = Object.freeze([
	0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

/**
 * Inspect an uncompressed RIFF or RF64 WAVE Blob without materializing its sample data.
 * The returned descriptor can be passed to `streamWavBlobPcm` to avoid parsing
 * the small container header twice.
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
	const signature = ascii(header, 0, 4);
	const rf64 = signature === 'RF64';
	if (signature !== 'RIFF' && !rf64) {
		if (signature === 'BW64') throw new Error('BW64 WAV files are not supported by the incremental WAV importer.');
		throw new Error('The file is not a RIFF WAV file.');
	}
	if (ascii(header, 8, 4) !== 'WAVE') throw new Error('The RIFF file is not a WAVE file.');
	let riffEnd;
	let rf64Directory = null;
	let offset = RIFF_HEADER_BYTES;
	let chunksRead = 0;
	if (rf64) {
		rf64Directory = await readRf64Directory(
			blob,
			signal,
			maxRiffChunks,
			headerView.getUint32(4, true),
		);
		riffEnd = rf64Directory.riffEnd;
		offset = rf64Directory.nextOffset;
		chunksRead = 1;
	} else {
		const riffPayloadBytes = headerView.getUint32(4, true);
		riffEnd = 8 + riffPayloadBytes;
		if (riffPayloadBytes < 4) throw new Error('The WAV RIFF size is invalid.');
		if (riffEnd > blob.size) throw new Error('The WAV RIFF payload is truncated.');
	}

	let format = null;
	let data = null;
	let factSampleCount = null;
	let bext = null;
	let cuePayload = null;
	const adtlPayloads = [];
	const infoPayloads = [];
	const metadataWarnings = [];
	let bextChunks = 0;
	while (offset < riffEnd) {
		throwIfAborted(signal);
		if (chunksRead >= maxRiffChunks) throw new Error(`The WAV file exceeds the ${maxRiffChunks}-chunk inspection limit.`);
		if (riffEnd - offset < CHUNK_HEADER_BYTES) throw new Error('The WAV file ends inside a RIFF chunk header.');
		const chunkHeader = await readBlobBytes(blob, offset, offset + CHUNK_HEADER_BYTES, signal);
		const chunkView = dataView(chunkHeader);
		const chunkId = ascii(chunkHeader, 0, 4);
		if (rf64 && chunkId === 'ds64') throw new Error('The RF64 file contains multiple ds64 chunks.');
		const declaredChunkBytes = chunkView.getUint32(4, true);
		let chunkBytes = declaredChunkBytes;
		if (rf64 && chunkId === 'data' && !data) {
			if (declaredChunkBytes === UINT32_SENTINEL) {
				chunkBytes = rf64Directory.dataByteLength;
			}
		} else if (rf64 && declaredChunkBytes === UINT32_SENTINEL) {
			chunkBytes = consumeRf64TableSize(rf64Directory, chunkId);
		}
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		if (chunkBytes > riffEnd - payloadOffset || chunkBytes > blob.size - payloadOffset) {
			if (chunkId === 'bext' && format && data) {
				bextChunks += 1;
				if (bextChunks > 1) {
					metadataWarnings.push(bextWarning(
						'bext-duplicate',
						'Multiple BEXT chunks were found; the first valid chunk is used.',
					));
				}
				metadataWarnings.push(bextWarning(
					'truncated-chunk',
					'The trailing BEXT chunk exceeds the RIFF payload and was ignored.',
				));
				break;
			}
			throw new Error(`The WAV ${printableChunkId(chunkId)} chunk is truncated.`);
		}
		const payloadEnd = payloadOffset + chunkBytes;
		chunksRead += 1;

		if (chunkId === 'fmt ' && !format) {
			if (chunkBytes < MINIMUM_FORMAT_BYTES) throw new Error('The WAV format chunk is too small.');
			const bytesToRead = Math.min(chunkBytes, EXTENSIBLE_FORMAT_BYTES);
			const formatBytes = await readBlobBytes(blob, payloadOffset, payloadOffset + bytesToRead, signal);
			format = parseWaveFormat(formatBytes, chunkBytes);
		} else if (chunkId === 'data' && !data) {
			data = { offset: payloadOffset, byteLength: chunkBytes };
		} else if (rf64 && chunkId === 'fact' && factSampleCount == null) {
			if (chunkBytes < 4) throw new Error('The RF64 fact chunk is too small to contain its sample count.');
			const factBytes = await readBlobBytes(blob, payloadOffset, payloadOffset + 4, signal);
			factSampleCount = dataView(factBytes).getUint32(0, true);
		} else if (chunkId === 'bext') {
			bextChunks += 1;
			if (bextChunks > 1) {
				metadataWarnings.push(bextWarning(
					'bext-duplicate',
					'Multiple BEXT chunks were found; the first valid chunk is used.',
				));
			}
			if (chunkBytes > BEXT_MAX_PAYLOAD_BYTES) {
				metadataWarnings.push(bextWarning(
					'bext-payload-too-large',
					`The BEXT payload is too large; metadata over ${BEXT_MAX_PAYLOAD_BYTES.toLocaleString('en-US')} bytes was ignored.`,
				));
			} else {
				const bytes = await readBlobBytes(blob, payloadOffset, payloadEnd, signal);
				const parsed = parseBextPayload(bytes);
				metadataWarnings.push(...parsed.warnings);
				if (!bext && parsed.metadata) bext = parsed.metadata;
			}
		} else if (chunkId === 'cue ' && cuePayload == null) {
			if (chunkBytes > MAX_RIFF_METADATA_BYTES) throw new Error('The WAV cue chunk exceeds the metadata safety limit.');
			cuePayload = await readBlobBytes(blob, payloadOffset, payloadEnd, signal);
		} else if (chunkId === 'LIST' && chunkBytes >= 4 && chunkBytes <= MAX_RIFF_METADATA_BYTES) {
			const listType = await readBlobBytes(blob, payloadOffset, payloadOffset + 4, signal);
			if (ascii(listType, 0, 4) === 'adtl') {
				adtlPayloads.push(await readBlobBytes(blob, payloadOffset + 4, payloadEnd, signal));
			} else if (ascii(listType, 0, 4) === 'INFO') {
				infoPayloads.push(await readBlobBytes(blob, payloadOffset + 4, payloadEnd, signal));
			}
		}

		const paddedEnd = payloadEnd + (chunkBytes % 2);
		if (paddedEnd > riffEnd) {
			// A few otherwise valid encoders omit the final RIFF pad byte. It is
			// harmless when both required chunks have already been discovered.
			if (!rf64 && payloadEnd === riffEnd && format && data) {
				if (chunkId === 'bext') {
					metadataWarnings.push(bextWarning(
						'invalid-padding',
						'The trailing BEXT chunk is missing its RIFF alignment byte.',
					));
				}
				break;
			}
			throw new Error(`The WAV ${printableChunkId(chunkId)} chunk is missing its pad byte.`);
		}
		if ((chunkBytes & 1) && chunkId === 'bext') {
			const padding = await readBlobBytes(blob, payloadEnd, paddedEnd, signal);
			if (padding[0] !== 0) {
				metadataWarnings.push(bextWarning(
					'invalid-padding',
					'The BEXT chunk has a non-zero RIFF alignment byte.',
				));
			}
		}
		offset = paddedEnd;
	}
	if (rf64Directory) assertRf64TableConsumed(rf64Directory);

	if (!format) throw new Error('The WAV file has no format chunk.');
	if (!data) throw new Error('The WAV file has no data chunk.');
	if (data.byteLength % format.blockAlign !== 0) {
		throw new Error('The WAV data chunk ends inside an interleaved PCM frame.');
	}
	const frameCount = data.byteLength / format.blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('The WAV file contains no complete PCM frames.');
	if (rf64Directory) {
		const sampleCount = factSampleCount != null && factSampleCount !== UINT32_SENTINEL
			? factSampleCount
			: rf64Directory.sampleCount;
		if (sampleCount !== frameCount) {
			const source = factSampleCount != null && factSampleCount !== UINT32_SENTINEL ? 'fact' : 'ds64';
			throw new Error(`The RF64 ${source} sample count does not match the PCM frame count.`);
		}
	}

	let markers = Object.freeze([]);
	let info = Object.freeze({});
	try {
		markers = parseRiffMarkers(cuePayload, adtlPayloads);
		info = parseRiffInfo(infoPayloads);
	} catch (error) {
		metadataWarnings.push(Object.freeze({ code: 'riff-markers-invalid', message: error instanceof Error ? error.message : String(error) }));
	}
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
		bext,
		markers,
		info,
		metadataWarnings: Object.freeze(metadataWarnings),
		dataOffset: data.offset,
		dataByteLength: data.byteLength,
		riffByteLength: riffEnd,
		sourceByteLength: blob.size,
	});
}

async function readRf64Directory(blob, signal, maxRiffChunks, declaredRiffPayloadBytes) {
	if (blob.size - RIFF_HEADER_BYTES < CHUNK_HEADER_BYTES) {
		throw new Error('The RF64 file ends inside its mandatory ds64 chunk header.');
	}
	const header = await readBlobBytes(
		blob,
		RIFF_HEADER_BYTES,
		RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES,
		signal,
	);
	if (ascii(header, 0, 4) !== 'ds64') throw new Error('The first RF64 chunk must be ds64.');
	const declaredBytes = dataView(header).getUint32(4, true);
	if (declaredBytes === UINT32_SENTINEL || declaredBytes < DS64_MINIMUM_BYTES) {
		throw new Error('The RF64 ds64 chunk is too small.');
	}
	const payloadOffset = RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES;
	if (blob.size - payloadOffset < DS64_MINIMUM_BYTES) throw new Error('The RF64 ds64 chunk is truncated.');
	const fixedBytes = await readBlobBytes(blob, payloadOffset, payloadOffset + DS64_MINIMUM_BYTES, signal);
	const fixedView = dataView(fixedBytes);
	const ds64RiffPayloadBytes = readSafeUint64(fixedView, 0, 'RF64 ds64 RIFF size');
	const dataByteLength = readSafeUint64(fixedView, 8, 'RF64 ds64 data size');
	const sampleCount = readSafeUint64(fixedView, 16, 'RF64 ds64 sample count');
	const tableLength = fixedView.getUint32(24, true);
	if (tableLength > maxRiffChunks) {
		throw new Error(`The RF64 ds64 table exceeds the ${maxRiffChunks}-entry inspection limit.`);
	}
	const requiredBytes = DS64_MINIMUM_BYTES + tableLength * DS64_TABLE_ENTRY_BYTES;
	if (requiredBytes > declaredBytes) throw new Error('The RF64 ds64 table is truncated.');
	if (requiredBytes !== declaredBytes) {
		throw new Error('The RF64 ds64 chunk size does not match its table length.');
	}
	const riffPayloadBytes = declaredRiffPayloadBytes === UINT32_SENTINEL
		? ds64RiffPayloadBytes
		: declaredRiffPayloadBytes;
	if (riffPayloadBytes < 4) throw new Error('The RF64 RIFF size is invalid.');
	const riffEnd = 8 + riffPayloadBytes;
	if (!Number.isSafeInteger(riffEnd)) throw new Error('The RF64 RIFF end exceeds the JavaScript safe integer range.');
	if (riffEnd > blob.size) throw new Error('The RF64 payload is truncated.');
	if (declaredBytes > riffEnd - payloadOffset || declaredBytes > blob.size - payloadOffset) {
		throw new Error('The RF64 ds64 chunk is truncated.');
	}
	const payloadEnd = payloadOffset + declaredBytes;
	const nextOffset = payloadEnd + (declaredBytes % 2);
	if (nextOffset > riffEnd) throw new Error('The RF64 ds64 chunk is missing its pad byte.');

	const table = new Map();
	if (tableLength > 0) {
		const bytes = await readBlobBytes(blob, payloadOffset, payloadOffset + requiredBytes, signal);
		const view = dataView(bytes);
		for (let index = 0; index < tableLength; index += 1) {
			const entryOffset = DS64_MINIMUM_BYTES + index * DS64_TABLE_ENTRY_BYTES;
			const chunkId = ascii(bytes, entryOffset, 4);
			if (chunkId === 'data') throw new Error('The RF64 ds64 table must not contain a data entry.');
			const byteLength = readSafeUint64(view, entryOffset + 4, `RF64 ds64 ${printableChunkId(chunkId)} size`);
			let queue = table.get(chunkId);
			if (!queue) {
				queue = { values: [], index: 0 };
				table.set(chunkId, queue);
			}
			queue.values.push(byteLength);
		}
	}
	return { riffEnd, dataByteLength, sampleCount, nextOffset, table };
}

function readSafeUint64(view, offset, name) {
	const value = view.getBigUint64(offset, true);
	if (value > MAX_SAFE_BIGINT) throw new Error(`The ${name} exceeds the JavaScript safe integer range.`);
	return Number(value);
}

function consumeRf64TableSize(directory, chunkId) {
	const queue = directory.table.get(chunkId);
	if (!queue || queue.index >= queue.values.length) {
		throw new Error(`The RF64 ${printableChunkId(chunkId)} sentinel has no ds64 table size.`);
	}
	const value = queue.values[queue.index];
	queue.index += 1;
	return value;
}

function assertRf64TableConsumed(directory) {
	for (const [chunkId, queue] of directory.table) {
		if (queue.index < queue.values.length) {
			throw new Error(`The RF64 file has an unused ds64 table entry for ${printableChunkId(chunkId)}.`);
		}
	}
}

function bextWarning(code, message) {
	return Object.freeze({ code, field: 'chunk', message });
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
	if (!Array.isArray(descriptor.metadataWarnings)
		|| descriptor.metadataWarnings.some((warning) => !warning || typeof warning.code !== 'string' || typeof warning.message !== 'string')) {
		throw new TypeError('WAV descriptor metadata warnings are invalid.');
	}
	if (descriptor.bext != null) {
		try {
			const normalized = normalizeBextMetadata(descriptor.bext, { version: descriptor.bext.version });
			const keys = Object.keys(normalized);
			if (Object.keys(descriptor.bext).length !== keys.length
				|| keys.some((key) => !Object.hasOwn(descriptor.bext, key)
					|| !Object.is(descriptor.bext[key], normalized[key]))) throw new TypeError();
		} catch {
			throw new TypeError('WAV descriptor BEXT metadata is invalid.');
		}
	}
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
