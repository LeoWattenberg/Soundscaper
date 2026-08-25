/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated utility-process boundary for reviewed target-native audio codecs. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute } from 'node:path';

const TARGETS = new Set(['mac-arm64', 'win-x64', 'win-arm64']);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const PATH_BYTES = 4096;
const CONFIGURATION_FIELDS = ['contractVersion', 'target', 'addonPath', 'addonSha256'];
const DECODE_REQUEST_FIELDS = [
	'contractVersion', 'operation', 'format', 'inputPath', 'outputPath', 'inputBytes', 'inputSha256',
	'maximumOutputBytes',
];
const ENCODE_REQUEST_FIELDS = [
	...DECODE_REQUEST_FIELDS, 'sampleRate', 'channelCount', 'bitrateKbps',
];
const NATIVE_DECODE_RESULT_FIELDS = [
	'status', 'nativeApiReached', 'exactTuplePassed', 'outputBytes', 'frameCount',
	'sampleRate', 'channelCount',
];
const NATIVE_ENCODE_RESULT_FIELDS = [...NATIVE_DECODE_RESULT_FIELDS, 'bitrateKbps'];
const NATIVE_UNAVAILABLE = new Set(['api-unavailable', 'tuple-unsupported']);

export async function runOperatingSystemAudioCodecJob(value, ports = {}) {
	const envelope = exactRecord(value, ['configuration', 'request'], 'OS audio codec helper job');
	const configuration = codecConfiguration(envelope.configuration);
	const request = codecRequest(envelope.request);
	if (dirname(request.inputPath) !== dirname(request.outputPath)
		|| request.inputPath === request.outputPath) {
		throw new TypeError('The OS audio codec request must use sibling private scratch files.');
	}
	const operations = {
		lstat: ports.lstat ?? lstat,
		readFile: ports.readFile ?? readFile,
		realpath: ports.realpath ?? realpath,
		loadAddon: ports.loadAddon ?? loadVerifiedAddon,
	};
	await assertAbsent(request.outputPath, operations.lstat);
	await inspectAuthenticatedFile({
		path: configuration.addonPath, expectedBytes: null,
		expectedSha256: configuration.addonSha256, label: 'addon', operations,
	});
	await inspectAuthenticatedFile({
		path: request.inputPath, expectedBytes: request.inputBytes,
		expectedSha256: request.inputSha256, label: 'input', operations,
	});
	const addon = await operations.loadAddon({
		addonPath: configuration.addonPath,
		addonSha256: configuration.addonSha256,
	});
	const method = addonMethod(addon, request);
	const nativeResult = inspectNativeResult(await method(Object.freeze({
		inputPath: request.inputPath,
		outputPath: request.outputPath,
		inputBytes: request.inputBytes,
		maximumOutputBytes: request.maximumOutputBytes,
		...(request.operation === 'audio-encode' ? {
			sampleRate: request.sampleRate,
			channelCount: request.channelCount,
			bitrateKbps: request.bitrateKbps,
		} : {}),
	})), request);
	if (nativeResult.status !== expectedNativeSuccess(request.operation)) {
		await assertAbsent(request.outputPath, operations.lstat);
		if (!NATIVE_UNAVAILABLE.has(nativeResult.status)) {
			throw new Error('The native OS audio codec failed after admission.');
		}
		return Object.freeze({
			contractVersion: 1,
			status: 'unavailable',
			reason: nativeResult.status,
			nativeApiReached: nativeResult.nativeApiReached,
		});
	}
	const output = await inspectBoundedOutput(request.outputPath,
		request.maximumOutputBytes, operations);
	if (request.operation === 'audio-encode') {
		const expectedFrames = request.inputBytes
			/ (request.channelCount * Float32Array.BYTES_PER_ELEMENT);
		if (nativeResult.status !== 'encoded' || nativeResult.outputBytes !== output.bytes.byteLength
			|| nativeResult.frameCount !== expectedFrames
			|| nativeResult.sampleRate !== request.sampleRate
			|| nativeResult.channelCount !== request.channelCount
			|| nativeResult.bitrateKbps !== request.bitrateKbps) {
			throw new Error('The native OS audio encoder result does not match its output file.');
		}
		return Object.freeze({
			contractVersion: 1, status: 'encoded', nativeApiReached: true,
			exactTuplePassed: true, outputBytes: output.bytes.byteLength,
			outputSha256: digest(output.bytes),
			encodedTuple: Object.freeze({
				sampleRate: nativeResult.sampleRate,
				channelCount: nativeResult.channelCount,
				frameCount: nativeResult.frameCount,
				bitrateKbps: nativeResult.bitrateKbps,
			}),
		});
	}
	if (nativeResult.status !== 'decoded') {
		throw new Error('The native OS audio decoder returned an inconsistent success.');
	}
	const expectedBytes = nativeResult.frameCount * nativeResult.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== nativeResult.outputBytes
		|| output.bytes.byteLength !== nativeResult.outputBytes) {
		throw new Error('The native OS audio decoder result does not match its output file.');
	}
	return Object.freeze({
		contractVersion: 1,
		status: 'decoded',
		nativeApiReached: true,
		exactTuplePassed: true,
		outputBytes: output.bytes.byteLength,
		outputSha256: digest(output.bytes),
		decodedGeometry: Object.freeze({
			sampleRate: nativeResult.sampleRate,
			channelCount: nativeResult.channelCount,
			frameCount: nativeResult.frameCount,
		}),
	});
}

/** Retained for callers deployed with the original decode-only helper exports. */
export const runOperatingSystemAudioDecodeJob = runOperatingSystemAudioCodecJob;
export const runOperatingSystemMp3DecodeJob = runOperatingSystemAudioCodecJob;

export function createOperatingSystemAudioCodecHelperWorker(options) {
	const configuration = codecConfiguration(options?.configuration);
	const target = targetForRuntime(options?.platform ?? process.platform, options?.arch ?? process.arch);
	if (target === null || target !== configuration.target) {
		throw new TypeError('The OS audio codec helper configuration does not match this process target.');
	}
	if (typeof options?.post !== 'function' || options.runJob !== undefined
		&& typeof options.runJob !== 'function' || options.exit !== undefined
		&& typeof options.exit !== 'function') {
		throw new TypeError('The OS audio codec helper worker ports are invalid.');
	}
	const runJob = options.runJob ?? runOperatingSystemAudioCodecJob;
	const exit = options.exit ?? (() => undefined);
	let active = false;
	let disposed = false;
	post(Object.freeze({ contractVersion: 1, type: 'ready', target }));

	function post(message) {
		if (disposed) return;
		try { options.post(message); }
		catch { dispose(1); }
	}

	function handleMessage(value, ports = []) {
		if (disposed) return;
		let message;
		try {
			message = exactRecord(value, ['contractVersion', 'type', 'request'], 'OS audio codec helper message');
			if (message.contractVersion !== 1 || message.type !== 'job'
				|| !Array.isArray(ports) || ports.length !== 0 || active) throw new TypeError('Invalid helper message.');
		} catch { dispose(1); return; }
		active = true;
		void Promise.resolve().then(() => runJob({ configuration, request: message.request })).then(
			(result) => post(Object.freeze({ contractVersion: 1, type: 'result', result })),
			() => post(Object.freeze({ contractVersion: 1, type: 'error', code: 'job-failed' })),
		).finally(() => { setImmediate(() => dispose(0)); });
	}

	function dispose(code) {
		if (disposed) return;
		disposed = true;
		exit(code);
	}

	return Object.freeze({ handleMessage, dispose });
}

function codecConfiguration(value) {
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'OS audio codec helper configuration');
	if (record.contractVersion !== 1 || typeof record.target !== 'string' || !TARGETS.has(record.target)) {
		throw new TypeError('The OS audio codec helper target is unsupported.');
	}
	return Object.freeze({
		contractVersion: 1,
		target: record.target,
		addonPath: absolutePath(record.addonPath, 'addon'),
		addonSha256: sha256(record.addonSha256, 'addon'),
	});
}

function codecRequest(value) {
	const operation = dataProperty(value, 'operation', 'OS audio codec helper request');
	const record = exactRecord(value, operation === 'audio-encode'
		? ENCODE_REQUEST_FIELDS : DECODE_REQUEST_FIELDS, 'OS audio codec helper request');
	if (record.contractVersion !== 1) throw new TypeError('The OS audio codec helper contract is unsupported.');
	if (operation !== 'audio-decode' && operation !== 'audio-encode') {
		throw new TypeError('The OS audio codec operation is unsupported.');
	}
	const format = audioFormat(record.format);
	if (operation === 'audio-encode' && format !== 'aac-m4a') {
		throw new TypeError('The OS audio codec encode format is unsupported.');
	}
	return Object.freeze({
		contractVersion: 1,
		operation,
		format,
		inputPath: absolutePath(record.inputPath, 'input'),
		outputPath: absolutePath(record.outputPath, 'output'),
		inputBytes: integer(record.inputBytes, 1, MAXIMUM_INPUT_BYTES, 'input byte length'),
		inputSha256: sha256(record.inputSha256, 'input'),
		maximumOutputBytes: integer(
			record.maximumOutputBytes, 1, MAXIMUM_OUTPUT_BYTES, 'maximum output byte length',
		),
		...(operation === 'audio-encode' ? {
			sampleRate: integer(record.sampleRate, 48_000, 48_000, 'encode sample rate'),
			channelCount: integer(record.channelCount, 2, 2, 'encode channel count'),
			bitrateKbps: integer(record.bitrateKbps, 160, 160, 'encode bitrate'),
		} : {}),
	});
}

function inspectNativeResult(value, request) {
	const encoding = request.operation === 'audio-encode';
	const record = exactRecord(value, encoding
		? NATIVE_ENCODE_RESULT_FIELDS : NATIVE_DECODE_RESULT_FIELDS, 'native OS audio codec result');
	if (typeof record.status !== 'string'
		|| record.nativeApiReached !== true && record.nativeApiReached !== false
		|| record.exactTuplePassed !== true && record.exactTuplePassed !== false) {
		throw new TypeError('The native OS audio codec result is malformed.');
	}
	const success = expectedNativeSuccess(request.operation);
	if (record.status === success) {
		if (record.nativeApiReached !== true || record.exactTuplePassed !== true) {
			throw new TypeError('The native OS audio codec success lacks exact native evidence.');
		}
		return Object.freeze({
			status: success, nativeApiReached: true, exactTuplePassed: true,
			outputBytes: integer(record.outputBytes, 1, MAXIMUM_OUTPUT_BYTES, 'native output byte length'),
			frameCount: integer(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'native frame count'),
			sampleRate: integer(record.sampleRate, 8_000, 192_000, 'native sample rate'),
			channelCount: integer(record.channelCount, 1, 8, 'native channel count'),
			...(encoding ? {
				bitrateKbps: integer(record.bitrateKbps, 1, 1_000, 'native bitrate'),
			} : {}),
		});
	}
	integer(record.outputBytes, 0, 0, 'unavailable native output byte length');
	integer(record.frameCount, 0, 0, 'unavailable native frame count');
	integer(record.sampleRate, 0, 0, 'unavailable native sample rate');
	integer(record.channelCount, 0, 0, 'unavailable native channel count');
	if (encoding) integer(record.bitrateKbps, 0, 0, 'unavailable native bitrate');
	if (record.exactTuplePassed !== false) {
		throw new TypeError('An unavailable native OS audio decode cannot pass its exact tuple.');
	}
	return Object.freeze({
		status: record.status,
		nativeApiReached: record.nativeApiReached,
		exactTuplePassed: false,
		outputBytes: 0,
		frameCount: 0,
		sampleRate: 0,
		channelCount: 0,
		...(encoding ? { bitrateKbps: 0 } : {}),
	});
}

async function inspectAuthenticatedFile({ path, expectedBytes, expectedSha256, label, operations }) {
	const before = await regularFile(path, label, operations);
	if (expectedBytes !== null && before.size !== expectedBytes) {
		throw new Error(`The OS audio codec ${label} byte length changed.`);
	}
	const bytes = await operations.readFile(path);
	const after = await regularFile(path, label, operations);
	if (!sameFile(before, after) || bytes.byteLength !== after.size) {
		throw new Error(`The OS audio codec ${label} changed while it was authenticated.`);
	}
	if (digest(bytes) !== expectedSha256) {
		throw new Error(`The OS audio codec ${label} digest changed.`);
	}
}

async function inspectBoundedOutput(path, maximumBytes, operations) {
	const before = await regularFile(path, 'output', operations);
	if (before.size < 1 || before.size > maximumBytes) {
		throw new Error('The OS audio codec output exceeds its bound.');
	}
	const bytes = new Uint8Array(await operations.readFile(path));
	const after = await regularFile(path, 'output', operations);
	if (!sameFile(before, after) || bytes.byteLength !== after.size) {
		throw new Error('The OS audio codec output changed while it was inspected.');
	}
	return Object.freeze({ bytes });
}

async function regularFile(path, label, operations) {
	const [metadata, canonical] = await Promise.all([operations.lstat(path), operations.realpath(path)]);
	if (!metadata.isFile() || metadata.isSymbolicLink() || canonical !== path
		|| !Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 0) {
		throw new Error(`The OS audio codec ${label} is not one exact regular file.`);
	}
	return Object.freeze({
		dev: Number(metadata.dev), ino: Number(metadata.ino), size: Number(metadata.size),
		mtimeMs: Number(metadata.mtimeMs),
	});
}

async function assertAbsent(path, lstatImpl) {
	try { await lstatImpl(path); }
	catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return;
		throw error;
	}
	throw new Error('The OS audio codec output path already exists.');
}

async function loadVerifiedAddon({ addonPath, addonSha256 }) {
	const bytes = await readFile(addonPath);
	if (digest(bytes) !== addonSha256) throw new Error('The OS audio codec addon digest changed before load.');
	return createRequire(import.meta.url)(addonPath);
}

function addonMethod(value, request) {
	if (!value || typeof value !== 'object') throw new TypeError('The OS audio codec addon is invalid.');
	const name = request.operation === 'audio-encode'
		? 'encodeOperatingSystemAacM4a'
		: request.format === 'mp3' ? 'decodeOperatingSystemMp3' : 'decodeOperatingSystemAacM4a';
	const method = Object.getOwnPropertyDescriptor(value, name);
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
		throw new TypeError('The OS audio codec addon does not expose its reviewed method.');
	}
	return method.value.bind(value);
}

function expectedNativeSuccess(operation) {
	return operation === 'audio-encode' ? 'encoded' : 'decoded';
}

function audioFormat(value) {
	if (value !== 'mp3' && value !== 'aac-m4a') {
		throw new TypeError('The OS audio codec format is unsupported.');
	}
	return value;
}

function exactRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be one plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.some((key) => typeof key !== 'string') || keys.length !== fields.length
		|| keys.some((key) => !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))) {
		throw new TypeError(`${label} has an inexact shape.`);
	}
	return value;
}

function dataProperty(value, name, label) {
	if (!value || typeof value !== 'object') throw new TypeError(`${label} is invalid.`);
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} is invalid.`);
	return descriptor.value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| Buffer.byteLength(value) > PATH_BYTES || value.split(/[\\/]/u).includes('..')) {
		throw new TypeError(`The OS audio codec ${label} path is invalid.`);
	}
	return value;
}

function sha256(value, label) {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The OS audio codec ${label} digest is invalid.`);
	}
	return value;
}

function integer(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The OS audio codec ${label} is invalid.`);
	}
	return value;
}

function sameFile(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function targetForRuntime(platform, arch) {
	if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
	if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) return `win-${arch}`;
	return null;
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const argument = process.argv.find((value) => value.startsWith('--os-audio-codec-config='));
	try {
		const worker = createOperatingSystemAudioCodecHelperWorker({
			configuration: JSON.parse(argument?.slice('--os-audio-codec-config='.length) ?? 'null'),
			post: (message) => parentPort.postMessage(message),
			exit: (code) => process.exit(code),
		});
		parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
	} catch {
		process.exit(1);
	}
}
