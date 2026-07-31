/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	createDesktopDirectPcmSignalAnalyzer,
	validateDesktopDirectPcmSignalEvidence,
} from './desktop-direct-wav-pcm-signal.mjs';

const MIB = 1024 * 1024;
const BEXT_OFFSET = 12;
const BEXT_FIXED_BODY_BYTES = 602;
const BEXT_PAYLOAD_BYTES = 689;
const BEXT_CHUNK_BYTES = 698;
const FORMAT_OFFSET = BEXT_OFFSET + BEXT_CHUNK_BYTES;
const FORMAT_BYTES = 40;
const DATA_OFFSET = FORMAT_OFFSET + 8 + FORMAT_BYTES;
const PCM_OFFSET = DATA_OFFSET + 8;
const PCM_SUBFORMAT_GUID = '0100000000001000800000aa00389b71';
const LOUDNESS_SENTINEL = 0x7fff;

const BEXT_METADATA = {
	description: 'Soundscaper packaged BWF smoke',
	originator: 'Soundscaper',
	originatorReference: 'PACKAGED-BWF-0001',
	originationDate: '2026-07-30',
	originationTime: '12:34:56',
	timeReference: '48000',
	version: 2,
	umid: '',
	loudnessValue: null,
	loudnessRange: null,
	maxTruePeakLevel: null,
	maxMomentaryLoudness: null,
	maxShortTermLoudness: null,
	codingHistory: 'A=PCM,F=48000,W=16,M=stereo,T=SmokeFixture\nA=PCM,F=384000,W=16,M=multi,T=Soundscaper\n',
};

export const DESKTOP_DIRECT_BWF_SMOKE_FIXTURE = deepFreeze({
	input: { sampleRate: 48_000, timeReference: '6000' },
	output: {
		sampleRate: 384_000,
		channelCount: 16,
		bitDepth: 16,
		frameCount: 6_335_992,
		bextPayloadBytes: BEXT_PAYLOAD_BYTES,
		bextChunkBytes: BEXT_CHUNK_BYTES,
		formatBytes: FORMAT_BYTES,
		headerByteLength: PCM_OFFSET,
		dataBytes: 202_751_744,
		dataPadBytes: 0,
		trailingBytes: 0,
		byteLength: 202_752_510,
	},
	bext: BEXT_METADATA,
});

export async function verifyDesktopDirectBwfFile(filePath, {
	expected = DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output,
	readChunkBytes = MIB,
	signalLimits,
} = {}) {
	const path = absolutePath(filePath);
	const geometry = validateExpectedGeometry(expected);
	const chunkBytes = integerInRange(readChunkBytes, 1, MIB, 'BWF read chunk bytes');
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error('Completed direct-BWF output must be a regular, non-symbolic file');
	}
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		assertStableIdentity(metadata, pathMetadata, 'before validation');
		if (metadata.size !== geometry.byteLength) {
			throw new Error(`Completed direct-BWF byte length is ${String(metadata.size)}, expected ${String(geometry.byteLength)}`);
		}
		const header = await readExactHeader(handle, geometry.headerByteLength);
		const { riff, bext } = parseAndValidateHeader(header, geometry);
		const analyzer = createDesktopDirectPcmSignalAnalyzer(geometry);
		const hash = createHash('sha256');
		let byteLength = 0;
		let maximumReadChunkBytes = 0;
		const pcmEnd = riff.pcmOffset + riff.dataBytes;
		const stream = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: chunkBytes });
		for await (const chunk of stream) {
			const bytes = Buffer.from(chunk);
			if (bytes.byteLength > chunkBytes || bytes.byteLength > MIB) {
				throw new Error('Completed direct-BWF streaming read exceeded its bound');
			}
			hash.update(bytes);
			maximumReadChunkBytes = Math.max(maximumReadChunkBytes, bytes.byteLength);
			const chunkEnd = byteLength + bytes.byteLength;
			const pcmStart = Math.max(byteLength, riff.pcmOffset);
			const pcmChunkEnd = Math.min(chunkEnd, pcmEnd);
			if (pcmChunkEnd > pcmStart) {
				analyzer.push(bytes.subarray(pcmStart - byteLength, pcmChunkEnd - byteLength));
			}
			byteLength = chunkEnd;
		}
		if (byteLength !== geometry.byteLength) {
			throw new Error('Completed direct-BWF EOF changed during validation');
		}
		const after = await handle.stat();
		assertStableIdentity(after, metadata, 'during validation');
		let afterPath;
		try {
			afterPath = await lstat(path);
		} catch (error) {
			throw new Error('Completed direct-BWF output path identity changed during validation', { cause: error });
		}
		assertStableIdentity(afterPath, pathMetadata, 'during path validation');
		const signal = validateDesktopDirectPcmSignalEvidence(analyzer.finish(), geometry, signalLimits);
		return deepFreeze({
			byteLength,
			sha256: hash.digest('hex'),
			maximumReadChunkBytes,
			riff,
			bext,
			signal,
		});
	} finally {
		await handle.close();
	}
}

export function validateDesktopDirectBwfFileEvidence(value) {
	assertPlainRecord(value, 'file evidence');
	assertExactKeys(
		value,
		['bext', 'byteLength', 'maximumReadChunkBytes', 'riff', 'sha256', 'signal'],
		'file evidence',
	);
	const geometry = validateExpectedGeometry(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output);
	if (value.byteLength !== geometry.byteLength) {
		throw new Error('Desktop direct-BWF file evidence byte length is invalid');
	}
	if (typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) {
		throw new Error('Desktop direct-BWF file evidence SHA-256 is invalid');
	}
	if (!Number.isSafeInteger(value.maximumReadChunkBytes)
		|| value.maximumReadChunkBytes < 1 || value.maximumReadChunkBytes > MIB) {
		throw new Error('Desktop direct-BWF file evidence read bound is invalid');
	}
	const riff = validateExactRecord(value.riff, expectedRiffEvidence(geometry), 'RIFF evidence');
	const bext = validateExactRecord(value.bext, DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext, 'BEXT evidence');
	const signal = validateDesktopDirectPcmSignalEvidence(value.signal, geometry);
	return deepFreeze({
		byteLength: value.byteLength,
		sha256: value.sha256,
		maximumReadChunkBytes: value.maximumReadChunkBytes,
		riff,
		bext,
		signal,
	});
}

function parseAndValidateHeader(header, expected) {
	const ascii = (offset) => header.toString('ascii', offset, offset + 4);
	const riff = {
		riffId: ascii(0),
		riffBytes: header.readUInt32LE(4) + 8,
		waveId: ascii(8),
		bextId: ascii(BEXT_OFFSET),
		bextOffset: BEXT_OFFSET,
		bextPayloadBytes: header.readUInt32LE(BEXT_OFFSET + 4),
		bextPadBytes: BEXT_PAYLOAD_BYTES & 1,
		formatId: ascii(FORMAT_OFFSET),
		formatOffset: FORMAT_OFFSET,
		formatBytes: header.readUInt32LE(FORMAT_OFFSET + 4),
		formatTag: header.readUInt16LE(FORMAT_OFFSET + 8),
		channelCount: header.readUInt16LE(FORMAT_OFFSET + 10),
		sampleRate: header.readUInt32LE(FORMAT_OFFSET + 12),
		byteRate: header.readUInt32LE(FORMAT_OFFSET + 16),
		blockAlign: header.readUInt16LE(FORMAT_OFFSET + 20),
		bitsPerSample: header.readUInt16LE(FORMAT_OFFSET + 22),
		extensionBytes: header.readUInt16LE(FORMAT_OFFSET + 24),
		validBitsPerSample: header.readUInt16LE(FORMAT_OFFSET + 26),
		channelMask: header.readUInt32LE(FORMAT_OFFSET + 28),
		subformatGuid: header.subarray(FORMAT_OFFSET + 32, FORMAT_OFFSET + 48).toString('hex'),
		dataId: ascii(DATA_OFFSET),
		dataOffset: DATA_OFFSET,
		dataBytes: header.readUInt32LE(DATA_OFFSET + 4),
		pcmOffset: PCM_OFFSET,
		dataPadBytes: 0,
		trailingBytes: 0,
		frameCount: expected.frameCount,
	};
	const wanted = expectedRiffEvidence(expected);
	const labels = {
		riffId: 'RIFF id',
		riffBytes: 'RIFF byte length',
		waveId: 'WAVE id',
		bextId: 'bext order',
		bextPayloadBytes: 'bext payload',
		formatId: 'fmt order',
		formatBytes: 'fmt payload',
		formatTag: 'format tag',
		channelCount: 'channel count',
		sampleRate: 'sample rate',
		byteRate: 'byte rate',
		blockAlign: 'block alignment',
		bitsPerSample: 'bits per sample',
		extensionBytes: 'extension size',
		validBitsPerSample: 'valid bits',
		channelMask: 'channel mask',
		subformatGuid: 'PCM subformat',
		dataId: 'data order',
		dataBytes: 'data byte length',
	};
	for (const key of Object.keys(wanted)) {
		if (riff[key] !== wanted[key]) {
			throw new Error(`Completed direct-BWF ${labels[key] ?? key} is ${JSON.stringify(riff[key])}, expected ${JSON.stringify(wanted[key])}`);
		}
	}
	const bextPadOffset = BEXT_OFFSET + 8 + BEXT_PAYLOAD_BYTES;
	if (header[bextPadOffset] !== 0) throw new Error('Completed direct-BWF bext pad is not zero');
	return Object.freeze({ riff: Object.freeze(riff), bext: parseAndValidateBext(header) });
}

function parseAndValidateBext(header) {
	const payload = BEXT_OFFSET + 8;
	validateFixedAscii(header, payload, 256, BEXT_METADATA.description, 'description');
	validateFixedAscii(header, payload + 256, 32, BEXT_METADATA.originator, 'originator');
	validateFixedAscii(header, payload + 288, 32, BEXT_METADATA.originatorReference, 'originator reference');
	validateFixedAscii(header, payload + 320, 10, BEXT_METADATA.originationDate, 'date');
	validateFixedAscii(header, payload + 330, 8, BEXT_METADATA.originationTime, 'time');
	const timeReference = (
		BigInt(header.readUInt32LE(payload + 338))
		+ (BigInt(header.readUInt32LE(payload + 342)) << 32n)
	).toString();
	if (timeReference !== BEXT_METADATA.timeReference) {
		throw new Error('Completed direct-BWF BEXT time reference is invalid');
	}
	if (header.readUInt16LE(payload + 346) !== 2) {
		throw new Error('Completed direct-BWF BEXT version is invalid');
	}
	if (header.subarray(payload + 348, payload + 412).some((byte) => byte !== 0)) {
		throw new Error('Completed direct-BWF BEXT UMID is invalid');
	}
	for (let offset = payload + 412; offset < payload + 422; offset += 2) {
		if (header.readUInt16LE(offset) !== LOUDNESS_SENTINEL) {
			throw new Error('Completed direct-BWF BEXT loudness sentinel is invalid');
		}
	}
	if (header.subarray(payload + 422, payload + BEXT_FIXED_BODY_BYTES).some((byte) => byte !== 0)) {
		throw new Error('Completed direct-BWF BEXT reserved bytes are invalid');
	}
	const codingHistory = Buffer.from(BEXT_METADATA.codingHistory.replaceAll('\n', '\r\n'), 'ascii');
	const encodedHistory = header.subarray(payload + BEXT_FIXED_BODY_BYTES, payload + BEXT_PAYLOAD_BYTES);
	if (!encodedHistory.equals(codingHistory)) {
		throw new Error('Completed direct-BWF BEXT coding history is invalid');
	}
	return Object.freeze({ ...BEXT_METADATA });
}

function validateFixedAscii(bytes, offset, length, expected, field) {
	const value = Buffer.from(expected, 'ascii');
	const fieldBytes = bytes.subarray(offset, offset + length);
	if (!fieldBytes.subarray(0, value.byteLength).equals(value)
		|| fieldBytes.subarray(value.byteLength).some((byte) => byte !== 0)) {
		throw new Error(`Completed direct-BWF BEXT ${field} is invalid`);
	}
}

function expectedRiffEvidence(expected) {
	return {
		riffId: 'RIFF',
		riffBytes: expected.byteLength,
		waveId: 'WAVE',
		bextId: 'bext',
		bextOffset: BEXT_OFFSET,
		bextPayloadBytes: BEXT_PAYLOAD_BYTES,
		bextPadBytes: 1,
		formatId: 'fmt ',
		formatOffset: FORMAT_OFFSET,
		formatBytes: FORMAT_BYTES,
		formatTag: 0xfffe,
		channelCount: expected.channelCount,
		sampleRate: expected.sampleRate,
		byteRate: expected.sampleRate * expected.blockAlign,
		blockAlign: expected.blockAlign,
		bitsPerSample: expected.bitDepth,
		extensionBytes: 22,
		validBitsPerSample: expected.bitDepth,
		channelMask: channelMask(expected.channelCount),
		subformatGuid: PCM_SUBFORMAT_GUID,
		dataId: 'data',
		dataOffset: DATA_OFFSET,
		dataBytes: expected.dataBytes,
		pcmOffset: expected.headerByteLength,
		dataPadBytes: expected.dataPadBytes,
		trailingBytes: expected.trailingBytes,
		frameCount: expected.frameCount,
	};
}

function validateExpectedGeometry(value) {
	assertPlainRecord(value, 'expected geometry');
	assertAllowedKeys(value, [
		'sampleRate', 'channelCount', 'bitDepth', 'frameCount', 'bextPayloadBytes',
		'bextChunkBytes', 'formatBytes', 'headerByteLength', 'dataBytes',
		'dataPadBytes', 'trailingBytes', 'byteLength',
	], 'expected geometry');
	const sampleRate = positiveInteger(value.sampleRate, 'expected sample rate');
	const channelCount = positiveInteger(value.channelCount, 'expected channel count');
	if (channelCount < 3 || channelCount > 32) {
		throw new RangeError('Desktop direct-BWF expected channel count must be from 3 through 32');
	}
	if (value.bitDepth !== 16) throw new RangeError('Desktop direct-BWF expected bit depth must be 16');
	const frameCount = positiveInteger(value.frameCount, 'expected frame count');
	const blockAlign = safeProduct(channelCount, 2, 'expected block alignment');
	const byteRate = safeProduct(sampleRate, blockAlign, 'expected byte rate');
	if (byteRate > 0xffff_ffff) throw new RangeError('Desktop direct-BWF expected byte rate exceeds RIFF geometry');
	const dataBytes = safeProduct(frameCount, blockAlign, 'expected PCM bytes');
	const byteLength = PCM_OFFSET + dataBytes;
	if (byteLength - 8 > 0xffff_ffff) {
		throw new RangeError('Desktop direct-BWF expected output exceeds classic RIFF geometry');
	}
	const wanted = {
		bextPayloadBytes: BEXT_PAYLOAD_BYTES,
		bextChunkBytes: BEXT_CHUNK_BYTES,
		formatBytes: FORMAT_BYTES,
		headerByteLength: PCM_OFFSET,
		dataBytes,
		dataPadBytes: 0,
		trailingBytes: 0,
		byteLength,
	};
	for (const [key, expected] of Object.entries(wanted)) {
		if (value[key] !== undefined && value[key] !== expected) {
			throw new Error(`Desktop direct-BWF expected ${key} is inconsistent`);
		}
	}
	return Object.freeze({
		sampleRate,
		channelCount,
		bitDepth: 16,
		frameCount,
		blockAlign,
		...wanted,
	});
}

async function readExactHeader(handle, byteLength) {
	const header = Buffer.alloc(byteLength);
	let offset = 0;
	while (offset < header.byteLength) {
		const { bytesRead } = await handle.read(header, offset, header.byteLength - offset, offset);
		if (!bytesRead) throw new Error('Completed direct-BWF header is truncated');
		offset += bytesRead;
	}
	return header;
}

function validateExactRecord(value, expected, label) {
	assertPlainRecord(value, label);
	assertExactKeys(value, Object.keys(expected), label);
	for (const key of Object.keys(expected)) {
		if (value[key] !== expected[key]) {
			throw new Error(`Desktop direct-BWF file evidence ${label} ${key} is invalid`);
		}
	}
	return Object.freeze({ ...value });
}

function assertStableIdentity(current, expected, phase) {
	if (!current.isFile() || current.isSymbolicLink()
		|| current.dev !== expected.dev || current.ino !== expected.ino
		|| current.size !== expected.size || current.mtimeMs !== expected.mtimeMs
		|| current.ctimeMs !== expected.ctimeMs) {
		throw new Error(`Completed direct-BWF output identity changed ${phase}`);
	}
}

function absolutePath(value) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError('Completed direct-BWF path must be normalized and absolute');
	}
	return value;
}

function channelMask(channelCount) {
	return channelCount === 32 ? 0xffff_ffff : (2 ** channelCount - 1) >>> 0;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`Desktop direct-BWF ${label} must be a positive safe integer`);
	}
	return value;
}

function safeProduct(left, right, label) {
	const value = left * right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`Desktop direct-BWF ${label} exceeds safe integer precision`);
	return value;
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop direct-${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop direct-BWF ${label} must be a plain object`);
	}
}

function assertAllowedKeys(value, allowed, label) {
	const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
	if (unexpected.length) {
		throw new TypeError(`Desktop direct-BWF ${label} has unexpected fields: ${unexpected.join(', ')}`);
	}
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError(`Desktop direct-BWF ${label} fields are invalid`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
