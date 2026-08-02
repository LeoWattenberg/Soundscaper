import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';
import { BEXT_MAX_PAYLOAD_BYTES, parseBextPayload } from './broadcast-wave.ts';
import { parseIxmlPayload } from './ixml.ts';
import { parseCartPayload } from './cart-metadata.ts';
import { finalizeRiffMetadata, wavMetadataWarning } from './wav-metadata-finalize.ts';
import {
	finalizeWavAdmImport,
	WAV_ADM_CHNA_MAX_BYTES,
	WAV_ADM_PAYLOAD_MAX_BYTES,
	wavAdmWarning,
} from './wav-adm-import.ts';
import {
	assertDs64TableConsumed,
	consumeDs64TableSize,
	DS64_UINT32_SENTINEL,
	readDs64Directory,
} from './wav-ds64.js';
import { ascii, dataView, printableChunkId, readBlobBytes, throwIfAborted } from './wav-import-io.ts';
import {
	createWavBlobPcmChunkReader,
	parseWavPcmFormat,
	WAV_PCM_EXTENSIBLE_FORMAT_BYTES,
	WAV_PCM_MINIMUM_FORMAT_BYTES,
} from './wav-pcm-chunk-reader.ts';
import { createWavAdmRiffSequencePreserver } from './wav-adm-riff-sequence.ts';
import {
	createWavOpaqueRiffCollector,
	shouldPreserveWavOpaqueRiffChunk,
	wavOpaqueRiffPreservationWarning,
} from './wav-opaque-chunks.ts';
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const DEFAULT_MAX_RIFF_CHUNKS = 4_096;
const UINT32_SENTINEL = DS64_UINT32_SENTINEL;
const MAX_RIFF_METADATA_BYTES = 16 * 1024 * 1024;

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
	const ds64Dialect = signature === 'RF64' ? 'rf64' : signature === 'BW64' ? 'bw64' : null;
	const rf64 = ds64Dialect === 'rf64';
	if (signature !== 'RIFF' && !ds64Dialect) {
		throw new Error('The file is not a RIFF WAV file.');
	}
	if (ascii(header, 8, 4) !== 'WAVE') throw new Error('The RIFF file is not a WAVE file.');
	let riffEnd;
	let ds64Directory = null;
	let offset = RIFF_HEADER_BYTES;
	let chunksRead = 0;
	if (ds64Dialect) {
		ds64Directory = await readDs64Directory(
			blob,
			signal,
			maxRiffChunks,
			headerView.getUint32(4, true),
			ds64Dialect,
			readBlobBytes,
		);
		riffEnd = ds64Directory.riffEnd;
		offset = ds64Directory.nextOffset;
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
	let ixml = null;
	let cart = null;
	const admStaticPayloads = [];
	let admSerialPayload = null;
	let admChna = null;
	const admPayloadKinds = new Set();
	let admChnaChunks = 0;
	const admWarnings = [];
	const opaqueRiffWarnings = [];
	const opaqueRiff = createWavOpaqueRiffCollector();
	const admRiffSequence = createWavAdmRiffSequencePreserver();
	const metadataWarnings = [];
	let bextChunks = 0;
	while (offset < riffEnd) {
		throwIfAborted(signal);
		if (chunksRead >= maxRiffChunks) throw new Error(`The WAV file exceeds the ${maxRiffChunks}-chunk inspection limit.`);
		if (riffEnd - offset < CHUNK_HEADER_BYTES) throw new Error('The WAV file ends inside a RIFF chunk header.');
		const chunkHeader = await readBlobBytes(blob, offset, offset + CHUNK_HEADER_BYTES, signal);
		const chunkView = dataView(chunkHeader);
		const chunkId = ascii(chunkHeader, 0, 4);
		if (ds64Directory && chunkId === 'ds64') throw new Error(`The ${ds64Directory.name} file contains multiple ds64 chunks.`);
		const declaredChunkBytes = chunkView.getUint32(4, true);
		let chunkBytes = declaredChunkBytes;
		if (ds64Directory && chunkId === 'data' && !data) {
			if (declaredChunkBytes === UINT32_SENTINEL) {
				chunkBytes = ds64Directory.dataByteLength;
			}
		} else if (ds64Directory && declaredChunkBytes === UINT32_SENTINEL) {
			chunkBytes = consumeDs64TableSize(ds64Directory, chunkId);
		}
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		if (chunkBytes > riffEnd - payloadOffset || chunkBytes > blob.size - payloadOffset) {
			if (isAdmChunkId(chunkId) && format && data) {
				admWarnings.push(wavAdmWarning(
					'adm-truncated-chunk',
					`The trailing ${chunkId.toUpperCase()} chunk exceeds the BW64 payload and was ignored.`,
				));
				break;
			}
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
		let listType = null;
		if (chunkId === 'LIST' && chunkBytes >= 4) {
			listType = ascii(await readBlobBytes(blob, payloadOffset, payloadOffset + 4, signal), 0, 4);
		}
		const preserveOpaqueChunk = ds64Dialect === 'bw64'
			&& shouldPreserveWavOpaqueRiffChunk(chunkId, listType);
		const preserveAdmSequenceChunk = admRiffSequence.shouldCapture(ds64Dialect, chunkId);

		if (chunkId === 'fmt ' && !format) {
			if (chunkBytes < WAV_PCM_MINIMUM_FORMAT_BYTES) throw new Error('The WAV format chunk is too small.');
			const bytesToRead = Math.min(chunkBytes, WAV_PCM_EXTENSIBLE_FORMAT_BYTES);
			const formatBytes = await readBlobBytes(blob, payloadOffset, payloadOffset + bytesToRead, signal);
			format = parseWavPcmFormat(formatBytes, chunkBytes);
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
		} else if (chunkId === 'iXML' && ixml == null) {
			if (chunkBytes > MAX_RIFF_METADATA_BYTES) throw new Error('The WAV iXML chunk exceeds the metadata safety limit.');
			try {
				ixml = parseIxmlPayload(await readBlobBytes(blob, payloadOffset, payloadEnd, signal));
			} catch (error) {
				metadataWarnings.push(Object.freeze({ code: 'ixml-invalid', message: error instanceof Error ? error.message : String(error) }));
			}
		} else if (chunkId === 'cart' && cart == null) {
			if (chunkBytes > MAX_RIFF_METADATA_BYTES) throw new Error('The WAV CART chunk exceeds the metadata safety limit.');
			try {
				cart = parseCartPayload(await readBlobBytes(blob, payloadOffset, payloadEnd, signal));
			} catch (error) {
				metadataWarnings.push(Object.freeze({ code: 'cart-invalid', message: error instanceof Error ? error.message : String(error) }));
			}
		} else if (isAdmPayloadChunkId(chunkId)) {
			const duplicate = admPayloadKinds.has(chunkId);
			if (duplicate) admWarnings.push(wavAdmWarning(
				'adm-payload-duplicate', `Multiple ${chunkId.toUpperCase()} chunks were found; the first bounded payload is preserved.`,
			));
			admPayloadKinds.add(chunkId);
			if (chunkBytes > WAV_ADM_PAYLOAD_MAX_BYTES) {
				admWarnings.push(wavAdmWarning('adm-payload-too-large', 'The ADM payload exceeds the 16 MiB safety limit and was ignored.'));
			} else if (!duplicate) {
				const captured = {
					kind: chunkId,
					bytes: await readBlobBytes(blob, payloadOffset, payloadEnd, signal),
				};
				if (chunkId === 'sxml') admSerialPayload = captured;
				else admStaticPayloads.push(captured);
			}
		} else if (chunkId === 'chna') {
			admChnaChunks += 1;
			if (admChnaChunks > 1) {
				admWarnings.push(wavAdmWarning('adm-chna-duplicate', 'Multiple CHNA chunks were found; the first bounded chunk is preserved.'));
			}
			if (chunkBytes > WAV_ADM_CHNA_MAX_BYTES) {
				admWarnings.push(wavAdmWarning('adm-chna-too-large', 'The CHNA payload exceeds its safety limit and was ignored.'));
			} else if (admChna == null) {
				admChna = await readBlobBytes(blob, payloadOffset, payloadEnd, signal);
			}
		} else if (chunkId === 'LIST' && chunkBytes >= 4 && chunkBytes <= MAX_RIFF_METADATA_BYTES) {
			if (listType === 'adtl') {
				adtlPayloads.push(await readBlobBytes(blob, payloadOffset + 4, payloadEnd, signal));
			} else if (listType === 'INFO') {
				infoPayloads.push(await readBlobBytes(blob, payloadOffset + 4, payloadEnd, signal));
			}
		}

		const paddedEnd = payloadEnd + (chunkBytes % 2);
		if (paddedEnd > riffEnd) {
			if (preserveOpaqueChunk && payloadEnd === riffEnd && format && data) {
				opaqueRiffWarnings.push(wavOpaqueRiffPreservationWarning(
					`The trailing ${printableChunkId(chunkId)} chunk is missing its RIFF alignment byte and cannot be preserved exactly.`,
				));
				break;
			}
			if (isAdmChunkId(chunkId) && payloadEnd === riffEnd && format && data) {
				admWarnings.push(wavAdmWarning(
					'adm-invalid-padding',
					`The trailing ${chunkId.toUpperCase()} chunk is missing its RIFF alignment byte.`,
				));
				break;
			}
			if (preserveAdmSequenceChunk && payloadEnd === riffEnd && format && data) {
				admRiffSequence.noteMissingPadding(chunkId);
				break;
			}
			// A few otherwise valid encoders omit the final RIFF pad byte. It is
			// harmless when both required chunks have already been discovered.
			if (!ds64Directory && payloadEnd === riffEnd && format && data) {
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
		if ((chunkBytes & 1) && (chunkId === 'bext' || isAdmChunkId(chunkId))) {
			const padding = await readBlobBytes(blob, payloadEnd, paddedEnd, signal);
			if (padding[0] !== 0) {
				if (chunkId === 'bext') {
					metadataWarnings.push(bextWarning(
						'invalid-padding',
						'The BEXT chunk has a non-zero RIFF alignment byte.',
					));
				} else {
					admWarnings.push(wavAdmWarning(
						'adm-invalid-padding',
						`The ${chunkId.toUpperCase()} chunk has a non-zero RIFF alignment byte.`,
					));
				}
			}
		}
		if (preserveOpaqueChunk) {
			const warning = await opaqueRiff.capture({
				id: chunkId,
				placement: data ? 'after-data' : 'before-data',
				declaredByteLength: declaredChunkBytes,
				rawByteLength: paddedEnd - offset,
				read: () => readBlobBytes(blob, offset, paddedEnd, signal),
			});
			if (warning) opaqueRiffWarnings.push(warning);
		}
		if (preserveAdmSequenceChunk) {
			await admRiffSequence.capture({
				id: chunkId, placement: data ? 'after-data' : 'before-data',
				declaredByteLength: declaredChunkBytes, rawByteLength: paddedEnd - offset,
				read: () => readBlobBytes(blob, offset, paddedEnd, signal),
			});
		}
		offset = paddedEnd;
	}
	if (ds64Directory) assertDs64TableConsumed(ds64Directory);

	if (!format) throw new Error('The WAV file has no format chunk.');
	if (!data) throw new Error('The WAV file has no data chunk.');
	if (data.byteLength % format.blockAlign !== 0) {
		throw new Error('The WAV data chunk ends inside an interleaved PCM frame.');
	}
	const frameCount = data.byteLength / format.blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('The WAV file contains no complete PCM frames.');
	if (rf64) {
		const sampleCount = factSampleCount != null && factSampleCount !== UINT32_SENTINEL
			? factSampleCount
			: ds64Directory.sampleCount;
		if (sampleCount !== frameCount) {
			const source = factSampleCount != null && factSampleCount !== UINT32_SENTINEL ? 'fact' : 'ds64';
			throw new Error(`The RF64 ${source} sample count does not match the PCM frame count.`);
		}
	}
	const finalizedAdm = finalizeWavAdmImport({
		container: ds64Dialect ?? 'riff',
		staticPayloads: admStaticPayloads,
		serialPayload: admSerialPayload,
		chna: admChna,
		channelCount: format.channelCount,
		priorWarnings: admWarnings,
		riffChunkSequence: admRiffSequence.snapshot(),
		opaqueRiffChunks: opaqueRiff.snapshot(),
		opaqueWarnings: [...opaqueRiffWarnings, ...admRiffSequence.warnings()],
	});
	metadataWarnings.push(...finalizedAdm.warnings);

	const { markers, info } = finalizeRiffMetadata(cuePayload, adtlPayloads, infoPayloads, metadataWarnings);
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
		ixml,
		cart,
		adm: finalizedAdm.metadata,
		metadataWarnings: Object.freeze(metadataWarnings),
		dataOffset: data.offset,
		dataByteLength: data.byteLength,
		riffByteLength: riffEnd,
		sourceByteLength: blob.size,
	});
}

const bextWarning = wavMetadataWarning;

function isAdmPayloadChunkId(value) {
	return value === 'axml' || value === 'bxml' || value === 'sxml';
}

function isAdmChunkId(value) {
	return value === 'chna' || isAdmPayloadChunkId(value);
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
	const inspectedDescriptor = options.descriptor == null
		? await inspectWavBlobPcm(blob, options)
		: options.descriptor;
	const reader = createWavBlobPcmChunkReader(blob, { descriptor: inspectedDescriptor, chunkFrames });
	const descriptor = reader.descriptor;
	throwIfAborted(signal);
	if (options.onFormat) {
		await options.onFormat(descriptor);
		throwIfAborted(signal);
	}

	for (let chunkIndex = 0; chunkIndex < reader.chunkCount; chunkIndex += 1) {
		const chunk = await reader.readChunk(chunkIndex, { signal });
		await options.onChunk(chunk.channels, Object.freeze({
			index: chunk.index,
			frameOffset: chunk.frameOffset,
			frames: chunk.frames,
			final: chunk.final,
			descriptor,
			signal,
		}));
		throwIfAborted(signal);
	}

	return Object.freeze({ ...descriptor, chunkFrames, chunkCount: reader.chunkCount });
}

function validateBlob(blob) {
	if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.slice !== 'function') {
		throw new TypeError('A Blob or File with size and slice() is required.');
	}
}

function positiveIntegerInRange(value, minimum, maximum, name) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value;
}
