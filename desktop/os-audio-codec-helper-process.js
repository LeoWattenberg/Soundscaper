/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated utility-process boundary for the target-native MP3 decoder. */

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
const REQUEST_FIELDS = [
	'contractVersion', 'inputPath', 'outputPath', 'inputBytes', 'inputSha256',
	'maximumOutputBytes',
];
const NATIVE_RESULT_FIELDS = [
	'status', 'nativeApiReached', 'exactTuplePassed', 'outputBytes', 'frameCount',
	'sampleRate', 'channelCount',
];
const NATIVE_UNAVAILABLE = new Set(['api-unavailable', 'tuple-unsupported']);

export async function runOperatingSystemMp3DecodeJob(value, ports = {}) {
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
	const method = addonMethod(addon);
	const nativeResult = inspectNativeResult(await method(Object.freeze({
		inputPath: request.inputPath,
		outputPath: request.outputPath,
		inputBytes: request.inputBytes,
		maximumOutputBytes: request.maximumOutputBytes,
	})));
	if (nativeResult.status !== 'decoded') {
		await assertAbsent(request.outputPath, operations.lstat);
		if (!NATIVE_UNAVAILABLE.has(nativeResult.status)) {
			throw new Error('The native OS MP3 decoder failed after admission.');
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
	const expectedBytes = nativeResult.frameCount * nativeResult.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== nativeResult.outputBytes
		|| output.bytes.byteLength !== nativeResult.outputBytes) {
		throw new Error('The native OS MP3 decoder result does not match its output file.');
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
	const record = exactRecord(value, REQUEST_FIELDS, 'OS audio codec helper request');
	if (record.contractVersion !== 1) throw new TypeError('The OS audio codec helper contract is unsupported.');
	return Object.freeze({
		contractVersion: 1,
		inputPath: absolutePath(record.inputPath, 'input'),
		outputPath: absolutePath(record.outputPath, 'output'),
		inputBytes: integer(record.inputBytes, 1, MAXIMUM_INPUT_BYTES, 'input byte length'),
		inputSha256: sha256(record.inputSha256, 'input'),
		maximumOutputBytes: integer(
			record.maximumOutputBytes, 1, MAXIMUM_OUTPUT_BYTES, 'maximum output byte length',
		),
	});
}

function inspectNativeResult(value) {
	const record = exactRecord(value, NATIVE_RESULT_FIELDS, 'native OS MP3 decode result');
	if (typeof record.status !== 'string'
		|| record.nativeApiReached !== true && record.nativeApiReached !== false
		|| record.exactTuplePassed !== true && record.exactTuplePassed !== false) {
		throw new TypeError('The native OS MP3 decode result is malformed.');
	}
	if (record.status === 'decoded') {
		if (record.nativeApiReached !== true || record.exactTuplePassed !== true) {
			throw new TypeError('The native OS MP3 decode success lacks exact native evidence.');
		}
		return Object.freeze({
			status: 'decoded', nativeApiReached: true, exactTuplePassed: true,
			outputBytes: integer(record.outputBytes, 1, MAXIMUM_OUTPUT_BYTES, 'native output byte length'),
			frameCount: integer(record.frameCount, 1, Number.MAX_SAFE_INTEGER, 'native frame count'),
			sampleRate: integer(record.sampleRate, 8_000, 192_000, 'native sample rate'),
			channelCount: integer(record.channelCount, 1, 8, 'native channel count'),
		});
	}
	integer(record.outputBytes, 0, 0, 'unavailable native output byte length');
	integer(record.frameCount, 0, 0, 'unavailable native frame count');
	integer(record.sampleRate, 0, 0, 'unavailable native sample rate');
	integer(record.channelCount, 0, 0, 'unavailable native channel count');
	if (record.exactTuplePassed !== false) {
		throw new TypeError('An unavailable native OS MP3 decode cannot pass its exact tuple.');
	}
	return Object.freeze({
		status: record.status,
		nativeApiReached: record.nativeApiReached,
		exactTuplePassed: false,
		outputBytes: 0,
		frameCount: 0,
		sampleRate: 0,
		channelCount: 0,
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

function addonMethod(value) {
	if (!value || typeof value !== 'object') throw new TypeError('The OS audio codec addon is invalid.');
	const method = Object.getOwnPropertyDescriptor(value, 'decodeOperatingSystemMp3');
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
		throw new TypeError('The OS audio codec addon does not expose its reviewed decoder.');
	}
	return method.value.bind(value);
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

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const argument = process.argv.find((value) => value.startsWith('--os-audio-codec-config='));
	let configuration;
	try {
		configuration = codecConfiguration(JSON.parse(argument?.slice('--os-audio-codec-config='.length) ?? 'null'));
	} catch {
		process.exit(1);
	}
	parentPort.postMessage(Object.freeze({ contractVersion: 1, type: 'ready', target: configuration.target }));
	let active = false;
	parentPort.on('message', (event) => {
		if (active) { process.exit(1); return; }
		active = true;
		void runOperatingSystemMp3DecodeJob({ configuration, request: event.data?.request }).then(
			(result) => parentPort.postMessage(Object.freeze({ contractVersion: 1, type: 'result', result })),
			() => parentPort.postMessage(Object.freeze({ contractVersion: 1, type: 'error', code: 'job-failed' })),
		).finally(() => { setImmediate(() => process.exit(0)); });
	});
}
