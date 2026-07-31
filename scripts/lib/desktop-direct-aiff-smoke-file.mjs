/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	DESKTOP_DIRECT_PCM_SIGNAL_LIMITS,
	createDesktopDirectPcmSignalAnalyzer,
	validateDesktopDirectPcmSignalEvidence,
} from './desktop-direct-wav-pcm-signal.mjs';

const MIB = 1024 * 1024;
const AIFF_HEADER_BYTES = 54;
const EXTENDED_SAMPLE_RATES = Object.freeze({
	48_000: '400ebb80000000000000',
	384_000: '4011bb80000000000000',
});

export const DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE = deepFreeze({
	output: {
		sampleRate: 384_000,
		sampleRateHex: EXTENDED_SAMPLE_RATES[384_000],
		channelCount: 16,
		bitDepth: 16,
		frameCount: 6_335_992,
		headerBytes: AIFF_HEADER_BYTES,
		dataBytes: 202_751_744,
		byteLength: 202_751_798,
	},
});

export async function verifyDesktopDirectAiffFile(filePath, {
	expected = DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output,
	readChunkBytes = MIB,
	signalLimits = DESKTOP_DIRECT_PCM_SIGNAL_LIMITS,
} = {}) {
	const path = absolutePath(filePath);
	const geometry = validateExpectedGeometry(expected);
	const chunkBytes = integerInRange(readChunkBytes, 1, MIB, 'AIFF read chunk bytes');
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error('Completed direct-AIFF output must be a regular, non-symbolic file');
	}
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		assertStableIdentity(metadata, pathMetadata, 'before validation');
		if (metadata.size !== geometry.byteLength) {
			throw new Error(`Completed direct-AIFF byte length is ${String(metadata.size)}, expected ${String(geometry.byteLength)}`);
		}
		const header = Buffer.alloc(AIFF_HEADER_BYTES);
		const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
		if (bytesRead !== header.byteLength) throw new Error('Completed direct-AIFF header is truncated');
		const aiff = parseAndValidateAiff(header, geometry);
		const analyzer = createDesktopDirectPcmSignalAnalyzer(geometry, { byteOrder: 'big-endian' });
		const hash = createHash('sha256');
		let byteLength = 0;
		let maximumReadChunkBytes = 0;
		const pcmEnd = aiff.pcmOffset + aiff.pcmBytes;
		const stream = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: chunkBytes });
		for await (const chunk of stream) {
			const bytes = Buffer.from(chunk);
			hash.update(bytes);
			maximumReadChunkBytes = Math.max(maximumReadChunkBytes, bytes.byteLength);
			const chunkEnd = byteLength + bytes.byteLength;
			const pcmStart = Math.max(byteLength, aiff.pcmOffset);
			const pcmChunkEnd = Math.min(chunkEnd, pcmEnd);
			if (pcmChunkEnd > pcmStart) {
				analyzer.push(bytes.subarray(pcmStart - byteLength, pcmChunkEnd - byteLength));
			}
			byteLength = chunkEnd;
		}
		if (byteLength !== geometry.byteLength) throw new Error('Completed direct-AIFF EOF changed during validation');
		const after = await handle.stat();
		assertStableIdentity(after, metadata, 'during validation');
		const signal = validateDesktopDirectPcmSignalEvidence(analyzer.finish(), geometry, signalLimits);
		return deepFreeze({
			byteLength,
			sha256: hash.digest('hex'),
			maximumReadChunkBytes,
			aiff,
			signal,
		});
	} finally {
		await handle.close();
	}
}

export function validateDesktopDirectAiffFileEvidence(value) {
	assertPlainRecord(value, 'file evidence');
	assertExactKeys(
		value,
		['aiff', 'byteLength', 'maximumReadChunkBytes', 'sha256', 'signal'],
		'file evidence',
	);
	const geometry = validateExpectedGeometry(DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output);
	if (value.byteLength !== geometry.byteLength) {
		throw new Error('Desktop direct-AIFF file evidence byte length is invalid');
	}
	if (typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) {
		throw new Error('Desktop direct-AIFF file evidence SHA-256 is invalid');
	}
	if (!Number.isSafeInteger(value.maximumReadChunkBytes)
		|| value.maximumReadChunkBytes < 1 || value.maximumReadChunkBytes > MIB) {
		throw new Error('Desktop direct-AIFF file evidence read bound is invalid');
	}
	const aiff = validateAiffEvidence(value.aiff, expectedAiffEvidence(geometry));
	const signal = validateDesktopDirectPcmSignalEvidence(value.signal, geometry);
	return deepFreeze({
		byteLength: value.byteLength,
		sha256: value.sha256,
		maximumReadChunkBytes: value.maximumReadChunkBytes,
		aiff,
		signal,
	});
}

function parseAndValidateAiff(header, expected) {
	const ascii = (offset) => header.toString('ascii', offset, offset + 4);
	const sampleRateHex = header.subarray(28, 38).toString('hex');
	const aiff = {
		formId: ascii(0),
		formBytes: header.readUInt32BE(4) + 8,
		typeId: ascii(8),
		commId: ascii(12),
		commBytes: header.readUInt32BE(16),
		channelCount: header.readUInt16BE(20),
		frameCount: header.readUInt32BE(22),
		bitsPerSample: header.readUInt16BE(26),
		sampleRateHex,
		soundId: ascii(38),
		soundBytes: header.readUInt32BE(42),
		offset: header.readUInt32BE(46),
		blockSize: header.readUInt32BE(50),
		pcmOffset: AIFF_HEADER_BYTES,
		pcmBytes: expected.dataBytes,
		dataPadBytes: 0,
		trailingBytes: 0,
	};
	const wanted = expectedAiffEvidence(expected);
	const labels = {
		formId: 'FORM id',
		formBytes: 'FORM byte length',
		typeId: 'AIFF type',
		commId: 'COMM id',
		commBytes: 'COMM size',
		channelCount: 'COMM channel count',
		frameCount: 'COMM frame count',
		bitsPerSample: 'COMM bits per sample',
		sampleRateHex: 'COMM sample rate',
		soundId: 'SSND id',
		soundBytes: 'SSND size',
		offset: 'SSND offset',
		blockSize: 'SSND block size',
	};
	for (const [key, value] of Object.entries(wanted)) {
		if (aiff[key] !== value) {
			throw new Error(`Completed direct-AIFF ${labels[key] ?? key} is ${JSON.stringify(aiff[key])}, expected ${JSON.stringify(value)}`);
		}
	}
	return Object.freeze(aiff);
}

function expectedAiffEvidence(expected) {
	return {
		formId: 'FORM',
		formBytes: expected.byteLength,
		typeId: 'AIFF',
		commId: 'COMM',
		commBytes: 18,
		channelCount: expected.channelCount,
		frameCount: expected.frameCount,
		bitsPerSample: 16,
		sampleRateHex: expected.sampleRateHex,
		soundId: 'SSND',
		soundBytes: expected.dataBytes + 8,
		offset: 0,
		blockSize: 0,
		pcmOffset: AIFF_HEADER_BYTES,
		pcmBytes: expected.dataBytes,
		dataPadBytes: 0,
		trailingBytes: 0,
	};
}

function validateAiffEvidence(value, expected) {
	assertPlainRecord(value, 'AIFF evidence');
	assertExactKeys(value, Object.keys(expected), 'AIFF evidence');
	for (const key of Object.keys(expected)) {
		if (value[key] !== expected[key]) {
			throw new Error(`Desktop direct-AIFF file evidence ${key} is invalid`);
		}
	}
	return Object.freeze({ ...value });
}

function validateExpectedGeometry(value) {
	assertPlainRecord(value, 'expected AIFF geometry');
	const sampleRate = positiveInteger(value.sampleRate, 'expected AIFF sample rate');
	const sampleRateHex = EXTENDED_SAMPLE_RATES[sampleRate];
	if (!sampleRateHex || (value.sampleRateHex !== undefined && value.sampleRateHex !== sampleRateHex)) {
		throw new Error('Expected direct-AIFF sample rate geometry is inconsistent');
	}
	const channelCount = positiveInteger(value.channelCount, 'expected AIFF channel count');
	if (channelCount > 32) throw new RangeError('Expected direct-AIFF channel count exceeds 32');
	if (value.bitDepth !== 16) throw new RangeError('Expected direct-AIFF bit depth must be 16');
	const frameCount = positiveInteger(value.frameCount, 'expected AIFF frame count');
	const blockAlign = safeProduct(channelCount, 2, 'expected AIFF block alignment');
	const dataBytes = safeProduct(frameCount, blockAlign, 'expected AIFF PCM bytes');
	const byteLength = AIFF_HEADER_BYTES + dataBytes;
	if (byteLength - 8 > 0xffff_ffff) throw new RangeError('Expected direct-AIFF output exceeds its FORM size');
	for (const [key, expected] of [
		['headerBytes', AIFF_HEADER_BYTES],
		['dataBytes', dataBytes],
		['byteLength', byteLength],
	]) {
		if (value[key] !== undefined && value[key] !== expected) {
			throw new Error(`Expected direct-AIFF ${key} is inconsistent`);
		}
	}
	return Object.freeze({
		sampleRate,
		sampleRateHex,
		channelCount,
		bitDepth: 16,
		frameCount,
		blockAlign,
		dataBytes,
		byteLength,
	});
}

function assertStableIdentity(current, expected, phase) {
	if (!current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino
		|| current.size !== expected.size) {
		throw new Error(`Completed direct-AIFF output identity changed ${phase}`);
	}
}

function absolutePath(value) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError('Completed direct-AIFF path must be normalized and absolute');
	}
	return value;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
	return value;
}

function safeProduct(left, right, label) {
	const value = left * right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds safe integer precision`);
	return value;
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop direct-AIFF ${label} must be a plain object`);
	}
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError(`Desktop direct-AIFF ${label} fields are invalid`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
