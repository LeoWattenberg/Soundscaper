/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';

import { createDesktopDirectWavPcmSignalAnalyzer, validateDesktopDirectWavPcmSignalEvidence } from './desktop-direct-wav-pcm-signal.mjs';
import {
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	absoluteDesktopDirectWavPath,
	createDesktopDirectWavStagingObserver,
	expectedRiff,
	parseAndValidateRiff,
	validateDesktopDirectWavOutputPaths,
	validateExpectedGeometry,
} from './desktop-direct-wav-staging-observer.mjs';
import { resolveSmokeArchitecture } from './desktop-smoke.mjs';

export {
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	absoluteDesktopDirectWavPath,
	createDesktopDirectWavStagingObserver,
	validateDesktopDirectWavOutputPaths,
};

export const DESKTOP_DIRECT_WAV_SMOKE_MODE = 'direct-wav-export-v1';
export const DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX = 'SOUNDSCAPER_DESKTOP_DIRECT_WAV_SMOKE ';
export const DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX = 'SOUNDSCAPER_DESKTOP_DIRECT_WAV_ACCEPTANCE ';

const MIB = 1024 * 1024;
const MAXIMUM_AGGREGATE_BYTES = 64 * 1024;
const MAXIMUM_STAGING_PREFIX_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^[a-f\d]{32}$/u;

export function validateDesktopDirectWavPlan(value) {
	assertPlainRecord(value, 'direct-WAV smoke plan');
	assertExactKeys(value, ['mode', 'productId', 'schemaVersion', 'token'], 'direct-WAV smoke plan');
	if (value.schemaVersion !== 1) throw new TypeError('Desktop direct-WAV smoke plan schema is unsupported');
	if (value.mode !== DESKTOP_DIRECT_WAV_SMOKE_MODE) throw new TypeError('Desktop direct-WAV smoke plan mode is unsupported');
	return {
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: validProduct(value.productId),
		token: validDesktopDirectWavToken(value.token),
	};
}

export function validateDesktopDirectWavPayload(value, invocation) {
	assertPlainRecord(value, 'direct-WAV result');
	assertExactKeys(value, ['mode', 'native', 'productId', 'renderer', 'schemaVersion', 'token'], 'direct-WAV result');
	if (value.schemaVersion !== 1 || value.mode !== DESKTOP_DIRECT_WAV_SMOKE_MODE) {
		throw new Error('Packaged direct-WAV result schema or mode is invalid');
	}
	if (value.productId !== invocation.productId) throw new Error('Packaged direct-WAV result product is invalid');
	if (value.token !== invocation.plan.token) throw new Error('Packaged direct-WAV result token is invalid');
	assertPlainRecord(value.renderer, 'direct-WAV result renderer');
	assertExactKeys(value.renderer, ['cancelled', 'completed', 'downloadVisible', 'imported', 'realtimeCount'], 'direct-WAV result renderer');
	for (const field of ['imported', 'completed', 'cancelled']) {
		if (value.renderer[field] !== true) throw new Error(`Packaged direct-WAV renderer ${field} evidence is invalid`);
	}
	if (value.renderer.realtimeCount !== 2) throw new Error('Packaged direct-WAV renderer realtime count is invalid');
	if (value.renderer.downloadVisible !== false) throw new Error('Packaged direct-WAV renderer download evidence is invalid');
	assertPlainRecord(value.native, 'direct-WAV result native');
	assertExactKeys(value.native, ['cancelledAbsent', 'completedBytes', 'selectionPurposes', 'stagingFilesRemaining'], 'direct-WAV result native');
	if (canonicalDesktopDirectWavJson(value.native.selectionPurposes) !== canonicalDesktopDirectWavJson(['audio-pcm-mix', 'audio-pcm-mix'])) {
		throw new Error('Packaged direct-WAV native save purpose evidence is invalid');
	}
	if (value.native.completedBytes !== DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength) {
		throw new Error('Packaged direct-WAV native completed bytes evidence is invalid');
	}
	if (value.native.cancelledAbsent !== true) throw new Error('Packaged direct-WAV native cancellation evidence is invalid');
	if (value.native.stagingFilesRemaining !== 0) throw new Error('Packaged direct-WAV native staging evidence is invalid');
}

export async function verifyDesktopDirectWavFile(filePath, {
	expected = DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output,
	readChunkBytes = MIB,
	signalLimits,
} = {}) {
	const path = absoluteDesktopDirectWavPath(filePath, 'completed WAV path');
	const geometry = validateExpectedGeometry(expected);
	const chunkBytes = integerInRange(readChunkBytes, 1, MIB, 'WAV read chunk bytes');
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error('Completed direct-WAV output must be a regular, non-symbolic file');
	}
	const handle = await open(path, 'r');
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
			throw new Error('Completed direct-WAV output identity changed before validation');
		}
		if (metadata.size !== geometry.byteLength) {
			throw new Error(`Completed direct-WAV byte length is ${String(metadata.size)}, expected ${String(geometry.byteLength)}`);
		}
		const header = Buffer.alloc(44);
		const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
		if (bytesRead !== header.byteLength) throw new Error('Completed direct-WAV RIFF header is truncated');
		const riff = parseAndValidateRiff(header, geometry);
		const signalAnalyzer = createDesktopDirectWavPcmSignalAnalyzer(geometry);
		const hash = createHash('sha256');
		let byteLength = 0;
		let maximumReadChunkBytes = 0;
		const stream = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: chunkBytes });
		for await (const chunk of stream) {
			const bytes = Buffer.from(chunk);
			hash.update(bytes);
			maximumReadChunkBytes = Math.max(maximumReadChunkBytes, bytes.byteLength);
			const pcmStart = Math.max(0, 44 - byteLength);
			signalAnalyzer.push(bytes.subarray(pcmStart));
			byteLength += bytes.byteLength;
		}
		if (byteLength !== geometry.byteLength) throw new Error('Completed direct-WAV EOF changed during validation');
		const after = await handle.stat();
		if (after.size !== metadata.size || after.dev !== metadata.dev || after.ino !== metadata.ino) {
			throw new Error('Completed direct-WAV output changed during validation');
		}
		const signal = validateDesktopDirectWavPcmSignalEvidence(signalAnalyzer.finish(), geometry, signalLimits);
		return freezeDesktopDirectWavValue({
			byteLength,
			sha256: hash.digest('hex'),
			maximumReadChunkBytes,
			signal,
			riff,
		});
	} finally {
		await handle.close();
	}
}

export function createDesktopDirectWavSmokeAggregate({
	invocation,
	payload,
	platform,
	arch,
	file,
	cancellation,
} = {}) {
	const plan = validateAggregateInvocation(invocation);
	validateDesktopDirectWavPayload(payload, invocation);
	const validatedFile = validateFileEvidence(file);
	const validatedCancellation = validateCancellationEvidence(cancellation);
	return freezeDesktopDirectWavValue({
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: plan.productId,
		platform: validDesktopDirectWavPlatform(platform),
		arch: resolveSmokeArchitecture(arch, arch),
		token: plan.token,
		renderer: payload.renderer,
		native: payload.native,
		file: validatedFile,
		cancellation: {
			stagingRiffGeometryValidated: true,
			nonzeroStagingPayloadByteObserved: true,
			maximumStagedBytes: validatedCancellation.maximumStagedBytes,
			maximumInspectedPrefixBytes: validatedCancellation.maximumInspectedPrefixBytes,
			cancelledFileAbsent: true,
			stagingFilesRemaining: 0,
		},
	});
}

export function formatDesktopDirectWavSmokeAggregate(aggregate) {
	const line = `${DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX}${canonicalDesktopDirectWavJson(aggregate)}`;
	if (Buffer.byteLength(line, 'utf8') > MAXIMUM_AGGREGATE_BYTES) {
		throw new RangeError('Packaged direct-WAV aggregate exceeds its 64 KiB output limit');
	}
	return line;
}

export async function assertDesktopDirectWavOutputCleanup(paths) {
	validateDesktopDirectWavOutputPaths(paths);
	let cancelledMissing = false;
	try {
		await lstat(paths.cancelled);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		cancelledMissing = true;
	}
	if (!cancelledMissing) throw new Error('Packaged cancelled direct-WAV output was unexpectedly published');
	const root = await lstat(paths.root);
	if (!root.isDirectory() || root.isSymbolicLink()) {
		throw new Error('Packaged direct-WAV smoke output root is not a direct directory');
	}
	const names = (await readdir(paths.root)).sort();
	if (canonicalDesktopDirectWavJson(names) !== canonicalDesktopDirectWavJson(['completed.wav'])) {
		throw new Error('Packaged direct-WAV smoke output inventory is not clean');
	}
}

function validateAggregateInvocation(value) {
	assertPlainRecord(value, 'direct-WAV invocation');
	const plan = validateDesktopDirectWavPlan(value.plan);
	if (value.productId !== plan.productId) throw new Error('Packaged direct-WAV invocation product does not match its plan');
	validateDesktopDirectWavOutputPaths(value.outputPaths);
	return plan;
}

function validateFileEvidence(value) {
	assertPlainRecord(value, 'direct-WAV file evidence');
	assertExactKeys(value, ['byteLength', 'maximumReadChunkBytes', 'riff', 'sha256', 'signal'], 'direct-WAV file evidence');
	if (value.byteLength !== DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength) throw new Error('Direct-WAV aggregate file byte length is invalid');
	if (typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) throw new Error('Direct-WAV aggregate file SHA-256 is invalid');
	if (!Number.isSafeInteger(value.maximumReadChunkBytes) || value.maximumReadChunkBytes < 1 || value.maximumReadChunkBytes > MIB) {
		throw new Error('Direct-WAV aggregate read bound is invalid');
	}
	const signal = validateDesktopDirectWavPcmSignalEvidence(value.signal, DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output);
	const expected = expectedRiff(validateExpectedGeometry(DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output));
	assertPlainRecord(value.riff, 'direct-WAV RIFF evidence');
	assertExactKeys(value.riff, Object.keys(expected), 'direct-WAV RIFF evidence');
	for (const key of Object.keys(expected)) {
		if (value.riff[key] !== expected[key]) throw new Error(`Direct-WAV aggregate RIFF ${key} is invalid`);
	}
	return freezeDesktopDirectWavValue({ ...value, riff: { ...value.riff }, signal });
}

function validateCancellationEvidence(value) {
	assertPlainRecord(value, 'direct-WAV cancellation evidence');
	assertExactKeys(value, [
		'cancelledFileAbsent',
		'maximumInspectedPrefixBytes',
		'maximumStagedBytes',
		'nonzeroPayloadByteObserved',
		'observed',
		'remainingStagingFiles',
		'riffHeaderValidated',
	], 'direct-WAV cancellation evidence');
	if (value.observed !== true || !Number.isSafeInteger(value.maximumStagedBytes) || value.maximumStagedBytes <= 44) {
		throw new Error('Direct-WAV cancellation did not independently observe a staged file with payload bytes');
	}
	if (value.riffHeaderValidated !== true) throw new Error('Direct-WAV cancellation staging RIFF geometry was not validated');
	if (value.nonzeroPayloadByteObserved !== true) throw new Error('Direct-WAV cancellation staging had no observed nonzero payload byte');
	if (!Number.isSafeInteger(value.maximumInspectedPrefixBytes)
		|| value.maximumInspectedPrefixBytes < 45
		|| value.maximumInspectedPrefixBytes > MAXIMUM_STAGING_PREFIX_BYTES
		|| value.maximumInspectedPrefixBytes > value.maximumStagedBytes) {
		throw new Error('Direct-WAV cancellation staging prefix evidence is invalid');
	}
	if (value.cancelledFileAbsent !== true) throw new Error('Direct-WAV cancelled file absence was not verified');
	if (value.remainingStagingFiles !== 0) throw new Error('Direct-WAV staging cleanup was not verified');
	return value;
}

export function validDesktopDirectWavToken(value) {
	if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
		throw new TypeError('Desktop direct-WAV smoke token must be 32 lowercase hexadecimal characters');
	}
	return value;
}

function validProduct(value) {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new TypeError('Desktop direct-WAV smoke product must be soundscaper or framescaper');
	}
	return value;
}

export function validDesktopDirectWavPlatform(value) {
	if (!['darwin', 'linux', 'win32'].includes(value)) throw new TypeError('Desktop direct-WAV smoke platform is unsupported');
	return value;
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop direct-WAV ${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop ${label} must be a plain object`);
	}
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const normalized = [...expected].sort();
	if (canonicalDesktopDirectWavJson(actual) !== canonicalDesktopDirectWavJson(normalized)) {
		const unexpected = actual.filter((key) => !normalized.includes(key));
		throw new TypeError(`Desktop ${label} has unexpected fields${unexpected.length ? `: ${unexpected.join(', ')}` : ''}`);
	}
}

export function canonicalDesktopDirectWavJson(value, active = new Set()) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical direct-WAV JSON requires finite numbers');
		return JSON.stringify(value);
	}
	if (!value || typeof value !== 'object') throw new TypeError('Canonical direct-WAV JSON contains an unsupported value');
	if (active.has(value)) throw new TypeError('Canonical direct-WAV JSON cannot contain cycles');
	active.add(value);
	try {
		if (Array.isArray(value)) return `[${value.map((item) => canonicalDesktopDirectWavJson(item, active)).join(',')}]`;
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
			throw new TypeError('Canonical direct-WAV JSON requires plain objects');
		}
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${canonicalDesktopDirectWavJson(value[key], active)}`
		)).join(',')}}`;
	} finally {
		active.delete(value);
	}
}

export function freezeDesktopDirectWavValue(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freezeDesktopDirectWavValue(child);
	return value;
}
