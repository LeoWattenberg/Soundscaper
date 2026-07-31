/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	createDesktopDirectPcmSignalAnalyzer,
	validateDesktopDirectPcmSignalEvidence,
} from './desktop-direct-wav-pcm-signal.mjs';

const MIB = 1024 * 1024;
const UINT32_SENTINEL = 0xffff_ffff;
const LOUDNESS_SENTINEL = 0x7fff;
const BEXT_FIXED_BODY_BYTES = 602;
const OFFSETS = Object.freeze({
	ds64: 12,
	bext: 48,
	format: 744,
	chna: 768,
	data: 1_020,
	pcm: 1_028,
});
const BEXT_METADATA = Object.freeze({
	description: 'Soundscaper packaged BW64 smoke',
	originator: 'Soundscaper',
	originatorReference: 'PACKAGED-BW64-0001',
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
	codingHistory: 'A=PCM,F=48000,W=16,M=multi,T=SmokeFixture\nA=PCM,F=384000,W=16,M=multi,T=Soundscaper\n',
});
const ADM_METADATA = Object.freeze({
	programmeName: 'Soundscaper packaged BW64 programme',
	programmeLanguage: '',
	contentName: 'Soundscaper packaged BW64 content',
	contentLanguage: '',
	bedName: 'Soundscaper packaged BW64 5.1 bed',
	layout: '5.1',
});
const PAYLOAD_HASHES = Object.freeze({
	bextPayload: '3fb39b40831a4ef0691749814e5c77b39ddc3e918d5c9e28c6f99e7ac292e61f',
	chnaPayload: '101309702cbb73f2568ccd1347580efe9a0fb5a7472356188062e7b17ee81f50',
	axmlPayload: '57bbe061083b62444af1bdb99481e746bc07eeb8d4a73c3fbfbd22fa7b18d243',
});
const CHNA_ENTRIES = Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
	trackIndex: index + 1,
	uid: `ATU_${String(index + 1).padStart(8, '0')}`,
	trackRef: `AC_0001000${String(index + 1)}_00`,
	packRef: 'AP_00010003',
})));

export const DESKTOP_DIRECT_BW64_SIGNAL_LIMITS = Object.freeze({
	minimumNonzeroFrames: 16_800_000,
	minimumPositiveFrames: 8_300_000,
	minimumNegativeFrames: 8_300_000,
	minimumZeroCrossings: 19_340,
	maximumZeroCrossings: 19_380,
	minimumPeakAbsoluteSample: 9_175,
	maximumPeakAbsoluteSample: 10_486,
	maximumAbsoluteMeanSample: 16,
	minimumRmsSample: 6_554,
	maximumRmsSample: 7_373,
});

export const DESKTOP_DIRECT_BW64_SMOKE_FIXTURE = deepFreeze({
	input: {
		sampleRate: 48_000,
		channelCount: 6,
		bitDepth: 16,
		frameCount: 2_112_000,
		floatPcmBytes: 50_688_000,
		timeReference: '6000',
	},
	plan: {
		sampleRate: 384_000,
		channelCount: 6,
		frameCount: 16_896_000,
		floatPcmBytes: 405_504_000,
		directThresholdBytes: 402_653_184,
	},
	output: {
		sampleRate: 384_000,
		channelCount: 6,
		bitDepth: 16,
		frameCount: 16_896_000,
		blockAlign: 12,
		dataBytes: 202_752_000,
		ds64PayloadBytes: 28,
		bextPayloadBytes: 688,
		bextChunkBytes: 696,
		formatBytes: 16,
		chnaPayloadBytes: 244,
		chnaChunkBytes: 252,
		axmlPayloadBytes: 2_472,
		axmlChunkBytes: 2_480,
		headerByteLength: 1_028,
		dataPadBytes: 0,
		byteLength: 202_755_508,
	},
	offsets: { ...OFFSETS, axml: 202_753_028 },
	bext: BEXT_METADATA,
	adm: ADM_METADATA,
	hashes: PAYLOAD_HASHES,
});

export async function verifyDesktopDirectBw64File(filePath, {
	expected = DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.output,
	readChunkBytes = MIB,
	signalLimits = DESKTOP_DIRECT_BW64_SIGNAL_LIMITS,
} = {}) {
	const path = absolutePath(filePath);
	const geometry = validateExpectedGeometry(expected);
	const chunkBytes = integerInRange(readChunkBytes, 1, MIB, 'read chunk bytes');
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error('Completed direct-BW64 output must be a regular, non-symbolic file');
	}
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		assertStableIdentity(metadata, pathMetadata, 'before validation');
		if (metadata.size !== geometry.byteLength) {
			throw new Error(`Completed direct-BW64 byte length is ${String(metadata.size)}, expected ${String(geometry.byteLength)}`);
		}
		const header = await readExact(handle, 0, geometry.headerByteLength, 'header');
		const { riff, bext, chna } = parseAndValidateHeader(header, geometry);
		const axmlChunk = await readExact(handle, geometry.axmlOffset, geometry.axmlChunkBytes, 'AXML chunk');
		const axml = parseAndValidateAxml(axmlChunk);
		const analyzer = createDesktopDirectPcmSignalAnalyzer(geometry);
		const hash = createHash('sha256');
		let byteLength = 0;
		let maximumReadChunkBytes = 0;
		const pcmEnd = geometry.axmlOffset;
		const stream = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: chunkBytes });
		for await (const chunk of stream) {
			const bytes = Buffer.from(chunk);
			if (bytes.byteLength > chunkBytes || bytes.byteLength > MIB) {
				throw new Error('Completed direct-BW64 streaming read exceeded its bound');
			}
			hash.update(bytes);
			maximumReadChunkBytes = Math.max(maximumReadChunkBytes, bytes.byteLength);
			const chunkEnd = byteLength + bytes.byteLength;
			const pcmStart = Math.max(byteLength, geometry.headerByteLength);
			const pcmChunkEnd = Math.min(chunkEnd, pcmEnd);
			if (pcmChunkEnd > pcmStart) {
				analyzer.push(bytes.subarray(pcmStart - byteLength, pcmChunkEnd - byteLength));
			}
			byteLength = chunkEnd;
		}
		if (byteLength !== geometry.byteLength) throw new Error('Completed direct-BW64 EOF changed during validation');
		const after = await handle.stat();
		assertStableIdentity(after, metadata, 'during validation');
		let afterPath;
		try {
			afterPath = await lstat(path);
		} catch (error) {
			throw new Error('Completed direct-BW64 output path identity changed during validation', { cause: error });
		}
		assertStableIdentity(afterPath, pathMetadata, 'during path validation');
		const signal = validateDesktopDirectPcmSignalEvidence(analyzer.finish(), geometry, signalLimits);
		return deepFreeze({
			byteLength,
			sha256: hash.digest('hex'),
			maximumReadChunkBytes,
			riff,
			bext,
			chna,
			axml,
			signal,
		});
	} finally {
		await handle.close();
	}
}

export function validateDesktopDirectBw64FileEvidence(value) {
	assertPlainRecord(value, 'file evidence');
	assertExactKeys(value, [
		'axml', 'bext', 'byteLength', 'chna', 'maximumReadChunkBytes', 'riff', 'sha256', 'signal',
	], 'file evidence');
	const geometry = validateExpectedGeometry(DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.output);
	if (value.byteLength !== geometry.byteLength) throw new Error('Desktop direct-BW64 file evidence byte length is invalid');
	if (typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) {
		throw new Error('Desktop direct-BW64 file evidence SHA-256 is invalid');
	}
	if (!Number.isSafeInteger(value.maximumReadChunkBytes)
		|| value.maximumReadChunkBytes < 1 || value.maximumReadChunkBytes > MIB) {
		throw new Error('Desktop direct-BW64 file evidence read bound is invalid');
	}
	const riff = validateExactRecord(value.riff, expectedRiffEvidence(geometry), 'RIFF evidence');
	const bext = validateExactRecord(value.bext, expectedBextEvidence(), 'BEXT evidence');
	const chna = validateChnaEvidence(value.chna);
	const axml = validateExactRecord(value.axml, expectedAxmlEvidence(), 'AXML evidence');
	const signal = validateDesktopDirectPcmSignalEvidence(
		value.signal,
		geometry,
		DESKTOP_DIRECT_BW64_SIGNAL_LIMITS,
	);
	return deepFreeze({
		byteLength: value.byteLength,
		sha256: value.sha256,
		maximumReadChunkBytes: value.maximumReadChunkBytes,
		riff,
		bext,
		chna,
		axml,
		signal,
	});
}

function parseAndValidateHeader(header, geometry) {
	const ascii = (offset) => header.toString('ascii', offset, offset + 4);
	const riff = {
		riffId: ascii(0),
		riffBytes32: header.readUInt32LE(4),
		riffBytes: safeUint64(header, OFFSETS.ds64 + 8, 'ds64 RIFF size') + 8,
		waveId: ascii(8),
		ds64Id: ascii(OFFSETS.ds64),
		ds64Offset: OFFSETS.ds64,
		ds64PayloadBytes: header.readUInt32LE(OFFSETS.ds64 + 4),
		dataBytes: safeUint64(header, OFFSETS.ds64 + 16, 'ds64 data size'),
		sampleCount: safeUint64(header, OFFSETS.ds64 + 24, 'sample count'),
		tableLength: header.readUInt32LE(OFFSETS.ds64 + 32),
		bextId: ascii(OFFSETS.bext),
		bextOffset: OFFSETS.bext,
		bextPayloadBytes: header.readUInt32LE(OFFSETS.bext + 4),
		bextPadBytes: 0,
		formatId: ascii(OFFSETS.format),
		formatOffset: OFFSETS.format,
		formatBytes: header.readUInt32LE(OFFSETS.format + 4),
		formatTag: header.readUInt16LE(OFFSETS.format + 8),
		channelCount: header.readUInt16LE(OFFSETS.format + 10),
		sampleRate: header.readUInt32LE(OFFSETS.format + 12),
		byteRate: header.readUInt32LE(OFFSETS.format + 16),
		blockAlign: header.readUInt16LE(OFFSETS.format + 20),
		bitsPerSample: header.readUInt16LE(OFFSETS.format + 22),
		chnaId: ascii(OFFSETS.chna),
		chnaOffset: OFFSETS.chna,
		chnaPayloadBytes: header.readUInt32LE(OFFSETS.chna + 4),
		chnaPadBytes: 0,
		dataId: ascii(OFFSETS.data),
		dataOffset: OFFSETS.data,
		dataBytes32: header.readUInt32LE(OFFSETS.data + 4),
		pcmOffset: OFFSETS.pcm,
		dataPadBytes: 0,
		axmlId: 'axml',
		axmlOffset: geometry.axmlOffset,
		axmlPayloadBytes: geometry.axmlPayloadBytes,
		axmlPadBytes: 0,
		trailingBytes: 0,
		frameCount: geometry.frameCount,
	};
	const wanted = expectedRiffEvidence(geometry);
	const labels = {
		riffId: 'BW64 id', riffBytes32: 'RIFF sentinel', riffBytes: 'ds64 RIFF size', waveId: 'WAVE id',
		ds64Id: 'ds64 order', ds64PayloadBytes: 'ds64 payload', dataBytes: 'ds64 data size',
		sampleCount: 'sample count', tableLength: 'table length', bextId: 'bext order',
		bextPayloadBytes: 'bext payload', formatId: 'fmt order', formatBytes: 'fmt payload',
		formatTag: 'format tag', channelCount: 'channel count', sampleRate: 'sample rate',
		byteRate: 'byte rate', blockAlign: 'block alignment', bitsPerSample: 'bits per sample',
		chnaId: 'chna order', chnaPayloadBytes: 'chna payload', dataId: 'data order',
		dataBytes32: 'data sentinel',
	};
	for (const key of Object.keys(wanted)) {
		if (riff[key] !== wanted[key]) {
			throw new Error(`Completed direct-BW64 ${labels[key] ?? key} is ${JSON.stringify(riff[key])}, expected ${JSON.stringify(wanted[key])}`);
		}
	}
	const bextPayload = header.subarray(OFFSETS.bext + 8, OFFSETS.format);
	const chnaPayload = header.subarray(OFFSETS.chna + 8, OFFSETS.data);
	return Object.freeze({
		riff: Object.freeze(riff),
		bext: parseAndValidateBext(bextPayload),
		chna: parseAndValidateChna(chnaPayload),
	});
}

function parseAndValidateBext(payload) {
	if (payload.byteLength !== 688 || hashPayload(payload) !== PAYLOAD_HASHES.bextPayload) {
		throw new Error('Completed direct-BW64 BEXT payload is invalid');
	}
	validateFixedAscii(payload, 0, 256, BEXT_METADATA.description, 'description');
	validateFixedAscii(payload, 256, 32, BEXT_METADATA.originator, 'originator');
	validateFixedAscii(payload, 288, 32, BEXT_METADATA.originatorReference, 'originator reference');
	validateFixedAscii(payload, 320, 10, BEXT_METADATA.originationDate, 'date');
	validateFixedAscii(payload, 330, 8, BEXT_METADATA.originationTime, 'time');
	const timeReference = (BigInt(payload.readUInt32LE(338)) + (BigInt(payload.readUInt32LE(342)) << 32n)).toString();
	if (timeReference !== BEXT_METADATA.timeReference) throw new Error('Completed direct-BW64 BEXT time reference is invalid');
	if (payload.readUInt16LE(346) !== 2) throw new Error('Completed direct-BW64 BEXT version is invalid');
	if (payload.subarray(348, 412).some((byte) => byte !== 0)) throw new Error('Completed direct-BW64 BEXT UMID is invalid');
	for (let offset = 412; offset < 422; offset += 2) {
		if (payload.readUInt16LE(offset) !== LOUDNESS_SENTINEL) throw new Error('Completed direct-BW64 BEXT loudness is invalid');
	}
	if (payload.subarray(422, BEXT_FIXED_BODY_BYTES).some((byte) => byte !== 0)) {
		throw new Error('Completed direct-BW64 BEXT reserved bytes are invalid');
	}
	const history = Buffer.from(BEXT_METADATA.codingHistory.replaceAll('\n', '\r\n'), 'ascii');
	if (!payload.subarray(BEXT_FIXED_BODY_BYTES).equals(history)) {
		throw new Error('Completed direct-BW64 BEXT coding history is invalid');
	}
	return Object.freeze({ ...BEXT_METADATA, payloadSha256: PAYLOAD_HASHES.bextPayload });
}

function parseAndValidateChna(payload) {
	if (payload.byteLength !== 244 || hashPayload(payload) !== PAYLOAD_HASHES.chnaPayload) {
		throw new Error('Completed direct-BW64 CHNA payload is invalid');
	}
	const numTracks = payload.readUInt16LE(0);
	const numUids = payload.readUInt16LE(2);
	const entries = Array.from({ length: 6 }, (_, index) => {
		const offset = 4 + index * 40;
		const entry = {
			trackIndex: payload.readUInt16LE(offset),
			uid: fixedAscii(payload, offset + 2, 12),
			trackRef: fixedAscii(payload, offset + 14, 14),
			packRef: fixedAscii(payload, offset + 28, 11),
		};
		if (payload[offset + 39] !== 0) throw new Error('Completed direct-BW64 CHNA entry pad is invalid');
		return Object.freeze(entry);
	});
	if (numTracks !== 6 || numUids !== 6) throw new Error('Completed direct-BW64 CHNA track counts are invalid');
	for (let index = 0; index < entries.length; index += 1) {
		for (const key of Object.keys(CHNA_ENTRIES[index])) {
			if (entries[index][key] !== CHNA_ENTRIES[index][key]) {
				throw new Error(`Completed direct-BW64 CHNA entry ${String(index + 1)} ${key} is invalid`);
			}
		}
	}
	return deepFreeze({ numTracks, numUids, entries, payloadSha256: PAYLOAD_HASHES.chnaPayload });
}

function parseAndValidateAxml(chunk) {
	if (chunk.toString('ascii', 0, 4) !== 'axml') throw new Error('Completed direct-BW64 AXML order is invalid');
	if (chunk.readUInt32LE(4) !== 2_472) throw new Error('Completed direct-BW64 AXML payload size is invalid');
	const payload = chunk.subarray(8);
	if (hashPayload(payload) !== PAYLOAD_HASHES.axmlPayload) throw new Error('Completed direct-BW64 AXML payload is invalid');
	return Object.freeze(expectedAxmlEvidence());
}

function validateExpectedGeometry(value) {
	assertPlainRecord(value, 'expected geometry');
	assertAllowedKeys(value, [
		'sampleRate', 'channelCount', 'bitDepth', 'frameCount', 'blockAlign', 'dataBytes',
		'ds64PayloadBytes', 'bextPayloadBytes', 'bextChunkBytes', 'formatBytes',
		'chnaPayloadBytes', 'chnaChunkBytes', 'axmlPayloadBytes', 'axmlChunkBytes',
		'headerByteLength', 'dataPadBytes', 'axmlOffset', 'byteLength',
	], 'expected geometry');
	if (value.sampleRate !== 384_000) throw new RangeError('Desktop direct-BW64 expected sample rate must be 384000');
	if (value.channelCount !== 6) throw new RangeError('Desktop direct-BW64 expected channel count must be 6');
	if (value.bitDepth !== 16) throw new RangeError('Desktop direct-BW64 expected bit depth must be 16');
	const frameCount = positiveInteger(value.frameCount, 'expected frame count');
	const dataBytes = safeProduct(frameCount, 12, 'expected PCM bytes');
	const axmlOffset = OFFSETS.pcm + dataBytes;
	const byteLength = axmlOffset + 2_480;
	const wanted = {
		blockAlign: 12,
		dataBytes,
		ds64PayloadBytes: 28,
		bextPayloadBytes: 688,
		bextChunkBytes: 696,
		formatBytes: 16,
		chnaPayloadBytes: 244,
		chnaChunkBytes: 252,
		axmlPayloadBytes: 2_472,
		axmlChunkBytes: 2_480,
		headerByteLength: OFFSETS.pcm,
		dataPadBytes: 0,
		axmlOffset,
		byteLength,
	};
	for (const [key, expected] of Object.entries(wanted)) {
		if (value[key] !== undefined && value[key] !== expected) {
			throw new Error(`Desktop direct-BW64 expected ${key} is inconsistent`);
		}
	}
	return Object.freeze({
		sampleRate: 384_000,
		channelCount: 6,
		bitDepth: 16,
		frameCount,
		...wanted,
	});
}

function expectedRiffEvidence(geometry) {
	return {
		riffId: 'BW64', riffBytes32: UINT32_SENTINEL, riffBytes: geometry.byteLength,
		waveId: 'WAVE', ds64Id: 'ds64', ds64Offset: OFFSETS.ds64, ds64PayloadBytes: 28,
		dataBytes: geometry.dataBytes, sampleCount: 0, tableLength: 0,
		bextId: 'bext', bextOffset: OFFSETS.bext, bextPayloadBytes: 688, bextPadBytes: 0,
		formatId: 'fmt ', formatOffset: OFFSETS.format, formatBytes: 16, formatTag: 1,
		channelCount: 6, sampleRate: 384_000, byteRate: 4_608_000,
		blockAlign: 12, bitsPerSample: 16,
		chnaId: 'chna', chnaOffset: OFFSETS.chna, chnaPayloadBytes: 244, chnaPadBytes: 0,
		dataId: 'data', dataOffset: OFFSETS.data, dataBytes32: UINT32_SENTINEL,
		pcmOffset: OFFSETS.pcm, dataPadBytes: 0,
		axmlId: 'axml', axmlOffset: geometry.axmlOffset, axmlPayloadBytes: 2_472,
		axmlPadBytes: 0, trailingBytes: 0, frameCount: geometry.frameCount,
	};
}

function expectedBextEvidence() {
	return { ...BEXT_METADATA, payloadSha256: PAYLOAD_HASHES.bextPayload };
}

function expectedAxmlEvidence() {
	return { version: 'ITU-R_BS.2076-3', ...ADM_METADATA, payloadSha256: PAYLOAD_HASHES.axmlPayload };
}

function validateChnaEvidence(value) {
	assertPlainRecord(value, 'CHNA evidence');
	assertExactKeys(value, ['entries', 'numTracks', 'numUids', 'payloadSha256'], 'CHNA evidence');
	if (value.numTracks !== 6 || value.numUids !== 6 || value.payloadSha256 !== PAYLOAD_HASHES.chnaPayload
		|| !Array.isArray(value.entries) || value.entries.length !== CHNA_ENTRIES.length) {
		throw new Error('Desktop direct-BW64 file evidence CHNA evidence is invalid');
	}
	const entries = value.entries.map((entry, index) => validateExactRecord(
		entry,
		CHNA_ENTRIES[index],
		`CHNA entry ${String(index + 1)}`,
	));
	return deepFreeze({ numTracks: 6, numUids: 6, entries, payloadSha256: PAYLOAD_HASHES.chnaPayload });
}

async function readExact(handle, position, byteLength, label) {
	const bytes = Buffer.alloc(byteLength);
	let offset = 0;
	while (offset < bytes.byteLength) {
		const result = await handle.read(bytes, offset, bytes.byteLength - offset, position + offset);
		if (!result.bytesRead) throw new Error(`Completed direct-BW64 ${label} is truncated`);
		offset += result.bytesRead;
	}
	return bytes;
}

function safeUint64(bytes, offset, label) {
	const value = bytes.readBigUInt64LE(offset);
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`Completed direct-BW64 ${label} exceeds safe precision`);
	return Number(value);
}

function hashPayload(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function fixedAscii(bytes, offset, length) {
	const field = bytes.subarray(offset, offset + length);
	const zero = field.indexOf(0);
	const end = zero < 0 ? field.byteLength : zero;
	if (zero >= 0 && field.subarray(zero).some((byte) => byte !== 0)) {
		throw new Error('Completed direct-BW64 fixed ASCII padding is invalid');
	}
	return field.toString('ascii', 0, end);
}

function validateFixedAscii(bytes, offset, length, expected, field) {
	if (fixedAscii(bytes, offset, length) !== expected) {
		throw new Error(`Completed direct-BW64 BEXT ${field} is invalid`);
	}
}

function validateExactRecord(value, expected, label) {
	assertPlainRecord(value, label);
	assertExactKeys(value, Object.keys(expected), label);
	for (const key of Object.keys(expected)) {
		if (value[key] !== expected[key]) {
			throw new Error(`Desktop direct-BW64 file evidence ${label} ${key} is invalid`);
		}
	}
	return Object.freeze({ ...value });
}

function assertStableIdentity(current, expected, phase) {
	if (!current.isFile() || current.isSymbolicLink()
		|| current.dev !== expected.dev || current.ino !== expected.ino
		|| current.size !== expected.size || current.mtimeMs !== expected.mtimeMs
		|| current.ctimeMs !== expected.ctimeMs) {
		throw new Error(`Completed direct-BW64 output identity changed ${phase}`);
	}
}

function absolutePath(value) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError('Completed direct-BW64 path must be normalized and absolute');
	}
	return value;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`Desktop direct-BW64 ${label} must be a positive safe integer`);
	}
	return value;
}

function safeProduct(left, right, label) {
	const value = left * right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`Desktop direct-BW64 ${label} exceeds safe integer precision`);
	return value;
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop direct-BW64 ${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop direct-BW64 ${label} must be a plain object`);
	}
}

function assertAllowedKeys(value, allowed, label) {
	const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
	if (unexpected.length) throw new TypeError(`Desktop direct-BW64 ${label} has unexpected fields: ${unexpected.join(', ')}`);
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError(`Desktop direct-BW64 ${label} fields are invalid`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
