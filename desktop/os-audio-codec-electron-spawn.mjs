/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utility-process transport for the one-shot OS audio codec helper. */

import { isAbsolute } from 'node:path';

const TARGETS = new Set(['mac-arm64', 'win-x64', 'win-arm64']);
const SHA256 = /^[a-f0-9]{64}$/u;
const CONFIGURATION_FIELDS = ['contractVersion', 'target', 'addonPath', 'addonSha256'];

export function createOperatingSystemAudioCodecElectronSpawn(options) {
	if (!options || typeof options !== 'object' || typeof options.fork !== 'function'
		|| typeof options.helperPath !== 'string' || !isAbsolute(options.helperPath)
		|| options.helperPath.includes('\0')) {
		throw new TypeError('The OS audio codec Electron spawn options are invalid.');
	}
	return (value) => {
		const configuration = codecConfiguration(value);
		const child = inspectedElectronChild(options.fork(
			options.helperPath,
			[`--os-audio-codec-config=${JSON.stringify(configuration)}`],
			{ serviceName: 'soundscaper-os-audio-codec-helper' },
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
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'OS audio codec child configuration');
	if (record.contractVersion !== 1 || typeof record.target !== 'string' || !TARGETS.has(record.target)) {
		throw new TypeError('The OS audio codec child target is unsupported.');
	}
	if (typeof record.addonPath !== 'string' || !isAbsolute(record.addonPath)
		|| record.addonPath.includes('\0') || Buffer.byteLength(record.addonPath) > 4096
		|| typeof record.addonSha256 !== 'string' || !SHA256.test(record.addonSha256)) {
		throw new TypeError('The OS audio codec child payload identity is invalid.');
	}
	return Object.freeze({
		contractVersion: 1, target: record.target, addonPath: record.addonPath,
		addonSha256: record.addonSha256,
	});
}

function inspectedElectronChild(value) {
	if (!value || typeof value !== 'object' || typeof value.postMessage !== 'function'
		|| typeof value.on !== 'function' || typeof value.off !== 'function'
		|| typeof value.kill !== 'function') {
		throw new TypeError('Electron returned an invalid OS audio codec utility process.');
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
