/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, open, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const MAXIMUM_STAGING_PREFIX_BYTES = 64 * 1024;
const DEFAULT_STAGING_SAMPLE_TIMEOUT_MS = 2_000;
const WRITE_ID_PATTERN = /^[a-f\d]{32}$/u;

export const DESKTOP_DIRECT_WAV_SMOKE_FIXTURE = Object.freeze({
	input: Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 792_000 }),
	output: Object.freeze({
		sampleRate: 384_000,
		channelCount: 16,
		bitDepth: 16,
		frameCount: 6_335_992,
		dataBytes: 202_751_744,
		byteLength: 202_751_788,
	}),
});

export function validateDesktopDirectWavOutputPaths(value) {
	assertPlainRecord(value, 'direct-WAV output paths');
	assertExactKeys(value, ['cancelled', 'completed', 'root'], 'direct-WAV output paths');
	const root = absoluteDesktopDirectWavPath(value.root, 'output root');
	const completed = absoluteDesktopDirectWavPath(value.completed, 'completed output');
	const cancelled = absoluteDesktopDirectWavPath(value.cancelled, 'cancelled output');
	if (dirname(completed) !== root || dirname(cancelled) !== root
		|| basename(completed) !== 'completed.wav' || basename(cancelled) !== 'cancelled.wav') {
		throw new Error('Desktop direct-WAV output paths leave their isolated root');
	}
}

export function createDesktopDirectWavStagingObserver(paths, {
	pollIntervalMs = 25,
	maximumPrefixBytes = MAXIMUM_STAGING_PREFIX_BYTES,
	sampleTimeoutMs = DEFAULT_STAGING_SAMPLE_TIMEOUT_MS,
	readdirImpl = readdir,
	lstatImpl = lstat,
	openImpl = open,
	setTimeoutImpl = setTimeout,
	clearTimeoutImpl = clearTimeout,
} = {}) {
	validateDesktopDirectWavOutputPaths(paths);
	const interval = integerInRange(pollIntervalMs, 1, 1000, 'staging poll interval');
	const prefixBytes = integerInRange(maximumPrefixBytes, 45, MAXIMUM_STAGING_PREFIX_BYTES, 'staging prefix bytes');
	const timeoutMs = integerInRange(sampleTimeoutMs, 10, 30_000, 'staging sample timeout');
	for (const [implementation, label] of [
		[readdirImpl, 'staging readdir implementation'],
		[lstatImpl, 'staging lstat implementation'],
		[openImpl, 'staging open implementation'],
		[setTimeoutImpl, 'staging timer implementation'],
		[clearTimeoutImpl, 'staging timer cancellation implementation'],
	]) {
		if (typeof implementation !== 'function') throw new TypeError(`Desktop direct-WAV ${label} is required`);
	}
	const pattern = new RegExp(`^\\.${escapeRegex(basename(paths.cancelled))}\\.([a-f\\d]{32})\\.soundscaper-part$`, 'u');
	const expected = validateExpectedGeometry(DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output);
	let maximumStagedBytes = 0;
	let maximumInspectedPrefixBytes = 0;
	let observed = false;
	let riffHeaderValidated = false;
	let nonzeroPayloadByteObserved = false;
	let stopped = false;
	let stopRequested = false;
	let failure;
	let wakePoll = null;
	const mergeSample = (sample) => {
		observed ||= sample.observed;
		riffHeaderValidated ||= sample.riffHeaderValidated;
		nonzeroPayloadByteObserved ||= sample.nonzeroPayloadByteObserved;
		maximumStagedBytes = Math.max(maximumStagedBytes, sample.maximumStagedBytes);
		maximumInspectedPrefixBytes = Math.max(maximumInspectedPrefixBytes, sample.maximumInspectedPrefixBytes);
	};
	const loop = (async () => {
		while (!stopRequested && !failure) {
			try {
				mergeSample(await boundedOperation(
					() => inspectStagingSample(paths.root, pattern, expected, prefixBytes, { readdirImpl, lstatImpl, openImpl }),
					timeoutMs,
					'Direct-WAV staging sampling',
					setTimeoutImpl,
					clearTimeoutImpl,
				));
			} catch (error) {
				failure = error;
				break;
			}
			if (!stopRequested) {
				await waitForPoll(interval, setTimeoutImpl, clearTimeoutImpl, (wake) => { wakePoll = wake; });
			}
		}
	})();
	return Object.freeze({
		async stop() {
			if (stopped) throw new Error('Direct-WAV staging observer was already stopped');
			stopped = true;
			stopRequested = true;
			wakePoll?.();
			await loop;
			if (failure) throw failure;
			const remainingStagingFiles = (await boundedOperation(
				() => directoryEntriesWith(paths.root, readdirImpl),
				timeoutMs,
				'Direct-WAV staging cleanup sampling',
				setTimeoutImpl,
				clearTimeoutImpl,
			)).filter((entry) => entry.name.endsWith('.soundscaper-part')).length;
			return Object.freeze({
				observed,
				riffHeaderValidated,
				nonzeroPayloadByteObserved,
				maximumStagedBytes,
				maximumInspectedPrefixBytes,
				remainingStagingFiles,
			});
		},
	});
}

export function validateExpectedGeometry(value) {
	assertPlainRecord(value, 'expected WAV geometry');
	const sampleRate = positiveInteger(value.sampleRate, 'expected WAV sample rate');
	const channelCount = positiveInteger(value.channelCount, 'expected WAV channel count');
	const bitDepth = positiveInteger(value.bitDepth, 'expected WAV bit depth');
	if (bitDepth !== 16) throw new RangeError('Expected direct-WAV bit depth must be 16');
	const frameCount = positiveInteger(value.frameCount, 'expected WAV frame count');
	const blockAlign = safeProduct(channelCount, bitDepth / 8, 'expected WAV block alignment');
	const dataBytes = safeProduct(frameCount, blockAlign, 'expected WAV data bytes');
	const byteLength = 44 + dataBytes;
	if (dataBytes > 0xffffffff || byteLength > 0xffffffff + 8) {
		throw new RangeError('Expected direct-WAV classic RIFF geometry is too large');
	}
	if (value.dataBytes !== undefined && value.dataBytes !== dataBytes) throw new Error('Expected direct-WAV data byte length is inconsistent');
	if (value.byteLength !== undefined && value.byteLength !== byteLength) throw new Error('Expected direct-WAV file byte length is inconsistent');
	return { sampleRate, channelCount, bitDepth, frameCount, blockAlign, dataBytes, byteLength };
}

export function parseAndValidateRiff(header, expected) {
	const ascii = (offset) => header.toString('ascii', offset, offset + 4);
	const riff = {
		riffId: ascii(0), riffBytes: header.readUInt32LE(4) + 8, waveId: ascii(8),
		formatId: ascii(12), formatBytes: header.readUInt32LE(16), formatTag: header.readUInt16LE(20),
		channelCount: header.readUInt16LE(22), sampleRate: header.readUInt32LE(24),
		byteRate: header.readUInt32LE(28), blockAlign: header.readUInt16LE(32),
		bitsPerSample: header.readUInt16LE(34), dataId: ascii(36), dataBytes: header.readUInt32LE(40),
		frameCount: expected.frameCount,
	};
	const wanted = expectedRiff(expected);
	for (const key of Object.keys(wanted)) {
		if (riff[key] !== wanted[key]) {
			throw new Error(`Completed direct-WAV ${key} is ${JSON.stringify(riff[key])}, expected ${JSON.stringify(wanted[key])}`);
		}
	}
	return Object.freeze(riff);
}

export function expectedRiff(expected) {
	return {
		riffId: 'RIFF', riffBytes: expected.byteLength, waveId: 'WAVE',
		formatId: 'fmt ', formatBytes: 16, formatTag: 1,
		channelCount: expected.channelCount, sampleRate: expected.sampleRate,
		byteRate: expected.sampleRate * expected.blockAlign, blockAlign: expected.blockAlign,
		bitsPerSample: expected.bitDepth, dataId: 'data', dataBytes: expected.dataBytes,
		frameCount: expected.frameCount,
	};
}

export function absoluteDesktopDirectWavPath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw new TypeError(`Desktop direct-WAV ${label} is required`);
	}
	const path = resolve(value);
	if (path !== value) throw new TypeError(`Desktop direct-WAV ${label} must be absolute and normalized`);
	return path;
}

async function inspectStagingSample(root, pattern, expected, maximumPrefixBytes, implementations) {
	const observation = {
		observed: false,
		riffHeaderValidated: false,
		nonzeroPayloadByteObserved: false,
		maximumStagedBytes: 0,
		maximumInspectedPrefixBytes: 0,
	};
	for (const entry of await directoryEntriesWith(root, implementations.readdirImpl)) {
		const match = pattern.exec(entry.name);
		if (!match) continue;
		if (!WRITE_ID_PATTERN.test(match[1])) throw new Error('Direct-WAV staging write identity is invalid');
		const path = resolve(root, entry.name);
		let metadata;
		try {
			metadata = await implementations.lstatImpl(path);
		} catch (error) {
			if (error?.code === 'ENOENT') continue;
			throw error;
		}
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error('Direct-WAV cancellation staging target is not a regular file');
		}
		observation.observed = true;
		observation.maximumStagedBytes = Math.max(observation.maximumStagedBytes, metadata.size);
		const inspected = await readStagingPrefix(path, metadata, maximumPrefixBytes, implementations.openImpl);
		if (!inspected) continue;
		const { bytes: prefix } = inspected;
		observation.maximumStagedBytes = Math.max(observation.maximumStagedBytes, inspected.fileSize);
		observation.maximumInspectedPrefixBytes = Math.max(observation.maximumInspectedPrefixBytes, prefix.byteLength);
		if (prefix.byteLength <= 44) continue;
		try {
			parseAndValidateRiff(prefix.subarray(0, 44), expected);
		} catch (error) {
			throw new Error('Direct-WAV cancellation staging RIFF geometry is invalid', { cause: error });
		}
		observation.riffHeaderValidated = true;
		for (let index = 44; !observation.nonzeroPayloadByteObserved && index < prefix.byteLength; index += 1) {
			if (prefix[index] !== 0) observation.nonzeroPayloadByteObserved = true;
		}
	}
	return observation;
}

async function readStagingPrefix(path, pathMetadata, maximumPrefixBytes, openImpl) {
	let handle;
	try {
		handle = await openImpl(path, 'r');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
			throw new Error('Direct-WAV cancellation staging identity changed before inspection');
		}
		const wanted = Math.min(metadata.size, maximumPrefixBytes);
		const bytes = Buffer.alloc(wanted);
		let offset = 0;
		while (offset < wanted) {
			const result = await handle.read(bytes, offset, wanted - offset, offset);
			if (!result.bytesRead) break;
			offset += result.bytesRead;
		}
		return { bytes: bytes.subarray(0, offset), fileSize: metadata.size };
	} finally {
		await handle.close();
	}
}

function boundedOperation(operation, timeoutMs, label, setTimeoutImpl, clearTimeoutImpl) {
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		let timer;
		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeoutImpl(timer);
			callback(value);
		};
		timer = setTimeoutImpl(() => {
			settle(rejectPromise, new Error(`${label} timed out after ${String(timeoutMs)} milliseconds`));
		}, timeoutMs);
		timer?.unref?.();
		Promise.resolve().then(operation).then(
			(value) => settle(resolvePromise, value),
			(error) => settle(rejectPromise, error),
		);
	});
}

function waitForPoll(interval, setTimeoutImpl, clearTimeoutImpl, exposeWake) {
	return new Promise((resolvePromise) => {
		let settled = false;
		let timer;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeoutImpl(timer);
			resolvePromise();
		};
		exposeWake(finish);
		timer = setTimeoutImpl(finish, interval);
		timer?.unref?.();
	});
}

async function directoryEntriesWith(path, readdirImpl) {
	try {
		return await readdirImpl(path, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop direct-WAV ${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
	return value;
}

function safeProduct(left, right, label) {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds JavaScript integer precision`);
	return result;
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
	if (actual.length !== normalized.length || actual.some((key, index) => key !== normalized[index])) {
		const unexpected = actual.filter((key) => !normalized.includes(key));
		throw new TypeError(`Desktop ${label} has unexpected fields${unexpected.length ? `: ${unexpected.join(', ')}` : ''}`);
	}
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
