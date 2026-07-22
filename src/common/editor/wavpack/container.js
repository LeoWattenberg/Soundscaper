/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmStorageCorruptionError,
	crc32,
	exactArrayBuffer,
	normalizePcmSampleRate,
	pcmRawByteLength,
	validatePcmGeometry,
} from './pcm.js';

export const PCM_CONTAINER_STORAGE_TYPE = 'opfs-pcm-v1';
export const PCM_CONTAINER_EXTENSION = '.scpcm';
export const PCM_CONTAINER_HEADER_BYTES = 32;
export const PCM_CONTAINER_INDEX_ENTRY_BYTES = 24;
export const PCM_CONTAINER_FOOTER_BYTES = 32;
export const PCM_CONTAINER_VERSION = 1;
export const PCM_CONTAINER_SAMPLE_FORMAT_FLOAT32_LE = 1;
export const PCM_CONTAINER_CODEC_RAW = 0;
export const PCM_CONTAINER_CODEC_WAVPACK = 1;

const HEADER_MAGIC = 'SSPCMWV1';
const FOOTER_MAGIC = 'SSPCMIDX';

export class PcmContainerWriter {
	constructor(writable, {
		channelCount,
		sampleRate,
		chunkFrames,
		flags = 0,
	} = {}) {
		if (!writable?.write || !writable?.close) {
			throw new TypeError('A writable OPFS stream is required.');
		}
		const geometry = validatePcmGeometry(Math.max(1, Number(chunkFrames) || 1), channelCount);
		this.writable = writable;
		this.channelCount = geometry.channelCount;
		this.sampleRate = normalizePcmSampleRate(sampleRate);
		this.chunkFrames = geometry.frames;
		this.flags = unsigned32(flags, 'container flags');
		this.entries = [];
		this.offset = PCM_CONTAINER_HEADER_BYTES;
		this.closed = false;
		this.uncompressedBytes = 0;
		this.storedBytes = 0;
		this.wavpackChunkCount = 0;
		this.rawChunkCount = 0;
		this.ready = this.writable.write(createPcmContainerHeader({
			channelCount: this.channelCount,
			sampleRate: this.sampleRate,
			chunkFrames: this.chunkFrames,
			flags: this.flags,
		}));
	}

	async write({
		encoding,
		payload: input,
		frames,
		pcmCrc32,
		flags = 0,
	} = {}) {
		if (this.closed) throw new Error('The PCM container writer is closed.');
		const geometry = validatePcmGeometry(frames, this.channelCount);
		if (geometry.frames > this.chunkFrames) {
			throw new RangeError('A PCM container chunk exceeds its nominal frame size.');
		}
		const payload = exactArrayBuffer(input);
		const rawBytes = pcmRawByteLength(geometry.frames, this.channelCount);
		const codec = encodingToContainerCodec(encoding);
		if ((codec === PCM_CONTAINER_CODEC_RAW && payload.byteLength !== rawBytes)
			|| (codec === PCM_CONTAINER_CODEC_WAVPACK
				&& (!payload.byteLength || payload.byteLength > rawBytes))) {
			throw new RangeError('A PCM container payload has invalid bounded geometry.');
		}
		await this.ready;
		await this.writable.write(payload);
		this.entries.push(Object.freeze({
			offset: this.offset,
			length: payload.byteLength,
			frames: geometry.frames,
			codec,
			flags: unsigned8(flags, 'chunk flags'),
			pcmCrc32: unsigned32(pcmCrc32, 'PCM CRC-32'),
		}));
		this.offset += payload.byteLength;
		this.uncompressedBytes += rawBytes;
		this.storedBytes += payload.byteLength;
		if (codec === PCM_CONTAINER_CODEC_WAVPACK) this.wavpackChunkCount += 1;
		else this.rawChunkCount += 1;
	}

	async close() {
		if (this.closed) return this.statistics();
		this.closed = true;
		await this.ready;
		const indexOffset = this.offset;
		const index = createPcmContainerIndex(this.entries);
		const footer = createPcmContainerFooter({
			chunkCount: this.entries.length,
			indexOffset,
			indexCrc32: crc32(index),
		});
		await this.writable.write(index);
		await this.writable.write(footer);
		await this.writable.close();
		return this.statistics();
	}

	statistics() {
		return compressionStatistics({
			uncompressedBytes: this.uncompressedBytes,
			storedBytes: this.storedBytes,
			wavpackChunkCount: this.wavpackChunkCount,
			rawChunkCount: this.rawChunkCount,
		});
	}
}

export function createPcmContainerHeader({
	channelCount,
	sampleRate,
	chunkFrames,
	flags = 0,
} = {}) {
	const geometry = validatePcmGeometry(chunkFrames, channelCount);
	const normalizedSampleRate = normalizePcmSampleRate(sampleRate);
	const bytes = new Uint8Array(PCM_CONTAINER_HEADER_BYTES);
	writeAscii(bytes, 0, HEADER_MAGIC);
	const view = new DataView(bytes.buffer);
	view.setUint16(8, PCM_CONTAINER_VERSION, true);
	view.setUint16(10, PCM_CONTAINER_HEADER_BYTES, true);
	view.setUint16(12, geometry.channelCount, true);
	view.setUint16(14, PCM_CONTAINER_SAMPLE_FORMAT_FLOAT32_LE, true);
	view.setUint32(16, normalizedSampleRate, true);
	view.setUint32(20, geometry.frames, true);
	view.setUint32(24, unsigned32(flags, 'container flags'), true);
	view.setUint32(28, crc32(bytes.subarray(0, 28)), true);
	return bytes;
}

export function createPcmContainerIndex(entries) {
	if (!Array.isArray(entries)) throw new TypeError('PCM container index entries are required.');
	const byteLength = entries.length * PCM_CONTAINER_INDEX_ENTRY_BYTES;
	if (!Number.isSafeInteger(byteLength)) throw new RangeError('PCM container index is too large.');
	const bytes = new Uint8Array(byteLength);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const offset = index * PCM_CONTAINER_INDEX_ENTRY_BYTES;
		setSafeUint64(view, offset, entry.offset, 'payload offset');
		view.setUint32(offset + 8, unsigned32(entry.length, 'payload length'), true);
		view.setUint32(offset + 12, unsigned32(entry.frames, 'frame count'), true);
		view.setUint8(offset + 16, unsigned8(entry.codec, 'codec'));
		view.setUint8(offset + 17, unsigned8(entry.flags ?? 0, 'chunk flags'));
		view.setUint16(offset + 18, 0, true);
		view.setUint32(offset + 20, unsigned32(entry.pcmCrc32, 'PCM CRC-32'), true);
	}
	return bytes;
}

export function createPcmContainerFooter({
	chunkCount,
	indexOffset,
	indexCrc32,
} = {}) {
	const bytes = new Uint8Array(PCM_CONTAINER_FOOTER_BYTES);
	writeAscii(bytes, 0, FOOTER_MAGIC);
	const view = new DataView(bytes.buffer);
	view.setUint16(8, PCM_CONTAINER_VERSION, true);
	view.setUint16(10, PCM_CONTAINER_INDEX_ENTRY_BYTES, true);
	view.setUint32(12, unsigned32(chunkCount, 'chunk count'), true);
	setSafeUint64(view, 16, indexOffset, 'index offset');
	view.setUint32(24, unsigned32(indexCrc32, 'index CRC-32'), true);
	view.setUint32(28, crc32(bytes.subarray(0, 28)), true);
	return bytes;
}

export async function parsePcmContainerIndex(file, {
	expectedChannelCount,
	expectedSampleRate,
	expectedChunkFrames,
	expectedChunkCount,
	expectedFrameCount,
	signal,
} = {}) {
	if (!file?.slice || !Number.isSafeInteger(file.size)) {
		throw new TypeError('A File or Blob snapshot is required.');
	}
	throwIfAborted(signal);
	if (file.size < PCM_CONTAINER_HEADER_BYTES + PCM_CONTAINER_FOOTER_BYTES) {
		throw corruption('The PCM container is truncated.', 'PCM_CONTAINER_TRUNCATED');
	}
	const [headerBytes, footerBytes] = await Promise.all([
		readExactSlice(file, 0, PCM_CONTAINER_HEADER_BYTES, signal),
		readExactSlice(
			file,
			file.size - PCM_CONTAINER_FOOTER_BYTES,
			file.size,
			signal,
		),
	]);
	const header = parseHeader(headerBytes);
	const footer = parseFooter(footerBytes);
	if (expectedChannelCount != null && header.channelCount !== Number(expectedChannelCount)) {
		throw corruption('PCM container channel count does not match source metadata.', 'PCM_CONTAINER_GEOMETRY');
	}
	if (expectedSampleRate != null && header.sampleRate !== Number(expectedSampleRate)) {
		throw corruption('PCM container sample rate does not match source metadata.', 'PCM_CONTAINER_GEOMETRY');
	}
	if (expectedChunkFrames != null && header.chunkFrames !== Number(expectedChunkFrames)) {
		throw corruption('PCM container chunk size does not match source metadata.', 'PCM_CONTAINER_GEOMETRY');
	}
	if (expectedChunkCount != null && footer.chunkCount !== Number(expectedChunkCount)) {
		throw corruption('PCM container chunk count does not match source metadata.', 'PCM_CONTAINER_GEOMETRY');
	}
	const indexBytesLength = footer.chunkCount * PCM_CONTAINER_INDEX_ENTRY_BYTES;
	if (!Number.isSafeInteger(indexBytesLength)
		|| footer.indexOffset < PCM_CONTAINER_HEADER_BYTES
		|| footer.indexOffset + indexBytesLength + PCM_CONTAINER_FOOTER_BYTES !== file.size) {
		throw corruption('PCM container index bounds are invalid.', 'PCM_CONTAINER_INDEX_BOUNDS');
	}
	const indexBytes = await readExactSlice(
		file,
		footer.indexOffset,
		footer.indexOffset + indexBytesLength,
		signal,
	);
	if (crc32(indexBytes) !== footer.indexCrc32) {
		throw corruption('PCM container index failed its CRC-32.', 'PCM_CONTAINER_INDEX_CRC');
	}
	const entries = parseEntries(indexBytes, {
		channelCount: header.channelCount,
		indexOffset: footer.indexOffset,
	});
	const frameCount = entries.reduce((sum, entry) => sum + entry.frames, 0);
	if (!Number.isSafeInteger(frameCount)
		|| (expectedFrameCount != null && frameCount !== Number(expectedFrameCount))) {
		throw corruption('PCM container frame count does not match source metadata.', 'PCM_CONTAINER_GEOMETRY');
	}
	return Object.freeze({
		...header,
		...footer,
		fileSize: file.size,
		frameCount,
		entries: Object.freeze(entries),
	});
}

export async function readPcmContainerPayload(file, entry, { signal } = {}) {
	if (!entry || !Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.length)) {
		throw corruption('PCM container index entry is invalid.', 'PCM_CONTAINER_INDEX_BOUNDS');
	}
	return readExactSlice(file, entry.offset, entry.offset + entry.length, signal);
}

export function containerCodecToEncoding(codec) {
	if (codec === PCM_CONTAINER_CODEC_RAW) return PCM_ENCODING_RAW_F32LE;
	if (codec === PCM_CONTAINER_CODEC_WAVPACK) return PCM_ENCODING_WAVPACK_F32_V1;
	throw corruption(`PCM container declares unsupported codec ${codec}.`, 'PCM_CONTAINER_CODEC');
}

export function encodingToContainerCodec(encoding) {
	if (encoding === PCM_ENCODING_RAW_F32LE) return PCM_CONTAINER_CODEC_RAW;
	if (encoding === PCM_ENCODING_WAVPACK_F32_V1) return PCM_CONTAINER_CODEC_WAVPACK;
	throw new TypeError(`Unsupported persistent PCM encoding: ${encoding}.`);
}

export function compressionStatistics({
	uncompressedBytes = 0,
	storedBytes = 0,
	wavpackChunkCount = 0,
	rawChunkCount = 0,
} = {}) {
	const raw = nonNegativeSafeInteger(uncompressedBytes, 'uncompressed byte count');
	const stored = nonNegativeSafeInteger(storedBytes, 'stored byte count');
	return Object.freeze({
		uncompressedBytes: raw,
		storedBytes: stored,
		wavpackChunkCount: nonNegativeSafeInteger(wavpackChunkCount, 'WavPack chunk count'),
		rawChunkCount: nonNegativeSafeInteger(rawChunkCount, 'raw chunk count'),
		compressionRatio: raw ? stored / raw : 1,
	});
}

function parseHeader(bytes) {
	if (readAscii(bytes, 0, 8) !== HEADER_MAGIC) {
		throw corruption('PCM container header magic is invalid.', 'PCM_CONTAINER_HEADER');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(8, true) !== PCM_CONTAINER_VERSION
		|| view.getUint16(10, true) !== PCM_CONTAINER_HEADER_BYTES
		|| view.getUint16(14, true) !== PCM_CONTAINER_SAMPLE_FORMAT_FLOAT32_LE
		|| view.getUint32(28, true) !== crc32(bytes.subarray(0, 28))) {
		throw corruption('PCM container header is invalid.', 'PCM_CONTAINER_HEADER');
	}
	const channelCount = view.getUint16(12, true);
	const sampleRate = view.getUint32(16, true);
	const chunkFrames = view.getUint32(20, true);
	try {
		validatePcmGeometry(chunkFrames, channelCount);
		normalizePcmSampleRate(sampleRate);
	} catch (error) {
		throw corruption('PCM container header geometry is invalid.', 'PCM_CONTAINER_GEOMETRY', error);
	}
	return Object.freeze({
		version: PCM_CONTAINER_VERSION,
		channelCount,
		sampleRate,
		sampleFormat: PCM_CONTAINER_SAMPLE_FORMAT_FLOAT32_LE,
		chunkFrames,
		flags: view.getUint32(24, true),
	});
}

function parseFooter(bytes) {
	if (readAscii(bytes, 0, 8) !== FOOTER_MAGIC) {
		throw corruption('PCM container footer magic is invalid.', 'PCM_CONTAINER_FOOTER');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(8, true) !== PCM_CONTAINER_VERSION
		|| view.getUint16(10, true) !== PCM_CONTAINER_INDEX_ENTRY_BYTES
		|| view.getUint32(28, true) !== crc32(bytes.subarray(0, 28))) {
		throw corruption('PCM container footer is invalid.', 'PCM_CONTAINER_FOOTER');
	}
	return Object.freeze({
		chunkCount: view.getUint32(12, true),
		indexOffset: getSafeUint64(view, 16, 'index offset'),
		indexCrc32: view.getUint32(24, true),
	});
}

function parseEntries(bytes, { channelCount, indexOffset }) {
	const entries = [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let expectedOffset = PCM_CONTAINER_HEADER_BYTES;
	for (let byteOffset = 0; byteOffset < bytes.byteLength; byteOffset += PCM_CONTAINER_INDEX_ENTRY_BYTES) {
		const offset = getSafeUint64(view, byteOffset, 'payload offset');
		const length = view.getUint32(byteOffset + 8, true);
		const frames = view.getUint32(byteOffset + 12, true);
		const codec = view.getUint8(byteOffset + 16);
		const flags = view.getUint8(byteOffset + 17);
		const reserved = view.getUint16(byteOffset + 18, true);
		const pcmCrc32 = view.getUint32(byteOffset + 20, true);
		let rawBytes;
		try {
			rawBytes = pcmRawByteLength(frames, channelCount);
		} catch (error) {
			throw corruption('PCM container chunk geometry is invalid.', 'PCM_CONTAINER_GEOMETRY', error);
		}
		if (reserved !== 0 || offset !== expectedOffset || !length
			|| offset + length > indexOffset
			|| (codec === PCM_CONTAINER_CODEC_RAW && length !== rawBytes)
			|| (codec === PCM_CONTAINER_CODEC_WAVPACK && length > rawBytes)
			|| (codec !== PCM_CONTAINER_CODEC_RAW && codec !== PCM_CONTAINER_CODEC_WAVPACK)) {
			throw corruption('PCM container index entry is invalid.', 'PCM_CONTAINER_INDEX_ENTRY');
		}
		entries.push(Object.freeze({
			index: entries.length,
			offset,
			length,
			frames,
			codec,
			flags,
			pcmCrc32,
		}));
		expectedOffset = offset + length;
	}
	if (expectedOffset !== indexOffset) {
		throw corruption('PCM container payload region is not contiguous.', 'PCM_CONTAINER_INDEX_BOUNDS');
	}
	return entries;
}

async function readExactSlice(file, start, end, signal) {
	throwIfAborted(signal);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
		|| start < 0 || end < start || end > file.size) {
		throw corruption('PCM container read is outside file bounds.', 'PCM_CONTAINER_READ_BOUNDS');
	}
	const buffer = await file.slice(start, end).arrayBuffer();
	throwIfAborted(signal);
	if (buffer.byteLength !== end - start) {
		throw corruption('PCM container is truncated.', 'PCM_CONTAINER_TRUNCATED');
	}
	return new Uint8Array(buffer);
}

function writeAscii(target, offset, value) {
	for (let index = 0; index < value.length; index += 1) {
		target[offset + index] = value.charCodeAt(index);
	}
}

function readAscii(bytes, offset, length) {
	let result = '';
	for (let index = 0; index < length; index += 1) {
		result += String.fromCharCode(bytes[offset + index]);
	}
	return result;
}

function setSafeUint64(view, offset, value, name) {
	const normalized = nonNegativeSafeInteger(value, name);
	view.setBigUint64(offset, BigInt(normalized), true);
}

function getSafeUint64(view, offset, name) {
	const value = view.getBigUint64(offset, true);
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw corruption(`PCM container ${name} exceeds safe browser bounds.`, 'PCM_CONTAINER_INDEX_BOUNDS');
	}
	return Number(value);
}

function unsigned32(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
		throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
	}
	return number;
}

function unsigned8(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0 || number > 0xff) {
		throw new RangeError(`${name} must be an unsigned 8-bit integer.`);
	}
	return number;
}

function nonNegativeSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function corruption(message, code, cause) {
	return new PcmStorageCorruptionError(message, code, cause ? { cause } : undefined);
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	const error = new Error('PCM container work was cancelled.');
	error.name = 'AbortError';
	throw error;
}
