/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron transport for authenticated one-shot bundled-codec utility processes. */

import { isAbsolute } from 'node:path';

const TARGETS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const CODECS = new Set(['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack']);
const SHA256 = /^[a-f0-9]{64}$/u;
const FIELDS = Object.freeze([
	'contractVersion', 'target', 'codec', 'runtimeRoot', 'moduleBytes', 'moduleSha256',
	'dependencies', 'wasmBytes', 'wasmSha256',
]);

export function createBundledAudioCodecElectronSpawn(options) {
	if (!options || typeof options !== 'object' || typeof options.fork !== 'function'
		|| typeof options.helperPath !== 'string' || !isAbsolute(options.helperPath)
		|| options.helperPath.includes('\0') || Buffer.byteLength(options.helperPath) > 4_096) {
		throw new TypeError('The bundled audio codec Electron spawn options are invalid.');
	}
	return (value) => {
		const configuration = codecConfiguration(value);
		const child = inspectedElectronChild(options.fork(
			options.helperPath,
			[`--bundled-audio-codec-config=${JSON.stringify(configuration)}`],
			{ serviceName: 'soundscaper-bundled-audio-codec-helper' },
		));
		return Object.freeze({
			postMessage: (message) => child.postMessage(message),
			onMessage: (listener) => subscribe(child, 'message', listener),
			onExit: (listener) => {
				if (typeof listener !== 'function') throw new TypeError('The helper exit listener is invalid.');
				const wrapped = (code) => listener(Number.isSafeInteger(code) ? code : null);
				return subscribe(child, 'exit', wrapped);
			},
			kill: () => { child.kill(); },
		});
	};
}

function codecConfiguration(value) {
	const record = exactRecord(value, FIELDS, 'bundled audio codec child configuration');
	if (record.contractVersion !== 1 || typeof record.target !== 'string' || !TARGETS.has(record.target)
		|| typeof record.codec !== 'string' || !CODECS.has(record.codec)
		|| typeof record.runtimeRoot !== 'string' || !isAbsolute(record.runtimeRoot)
		|| record.runtimeRoot.includes('\0') || Buffer.byteLength(record.runtimeRoot) > 4_096
		|| !Number.isSafeInteger(record.moduleBytes) || record.moduleBytes < 1
		|| record.moduleBytes > 2 * 1024 * 1024
		|| typeof record.moduleSha256 !== 'string' || !SHA256.test(record.moduleSha256)
		|| !Array.isArray(record.dependencies) || record.dependencies.length < 1
		|| record.dependencies.length > 8
		|| !Number.isSafeInteger(record.wasmBytes) || record.wasmBytes < 8
		|| record.wasmBytes > 2 * 1024 * 1024
		|| typeof record.wasmSha256 !== 'string' || !SHA256.test(record.wasmSha256)) {
		throw new TypeError('The bundled audio codec child configuration is invalid.');
	}
	const dependencies = record.dependencies.map((value) => dependency(value));
	if (new Set(dependencies.map(({ path }) => path)).size !== dependencies.length) {
		throw new TypeError('The bundled audio codec child dependency inventory is invalid.');
	}
	return Object.freeze({
		contractVersion: 1, target: record.target, codec: record.codec,
		runtimeRoot: record.runtimeRoot, moduleBytes: record.moduleBytes,
		moduleSha256: record.moduleSha256, dependencies: Object.freeze(dependencies),
		wasmBytes: record.wasmBytes,
		wasmSha256: record.wasmSha256,
	});
}

function dependency(value) {
	const record = exactRecord(value, ['path', 'byteLength', 'sha256'], 'bundled codec dependency');
	if (typeof record.path !== 'string' || record.path.startsWith('/') || record.path.includes('\\')
		|| record.path.split('/').includes('..') || Buffer.byteLength(record.path) > 4_096
		|| !Number.isSafeInteger(record.byteLength) || record.byteLength < 1
		|| record.byteLength > 2 * 1024 * 1024
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new TypeError('The bundled audio codec child dependency inventory is invalid.');
	}
	return Object.freeze({
		path: record.path, byteLength: record.byteLength, sha256: record.sha256,
	});
}

function inspectedElectronChild(value) {
	if (!value || typeof value !== 'object' || typeof value.postMessage !== 'function'
		|| typeof value.on !== 'function' || typeof value.off !== 'function'
		|| typeof value.kill !== 'function') {
		throw new TypeError('Electron returned an invalid bundled audio codec utility process.');
	}
	return value;
}

function subscribe(child, event, listener) {
	if (typeof listener !== 'function') throw new TypeError('The helper listener is invalid.');
	child.on(event, listener);
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		child.off(event, listener);
	};
}

function exactRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))) {
		throw new TypeError(`${label} has an inexact shape.`);
	}
	return value;
}
