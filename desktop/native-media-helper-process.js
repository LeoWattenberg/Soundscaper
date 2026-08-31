/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utility-process entry for the isolated Framescaper media host. */

import {
	createNativeMediaHelperJobRunner,
} from './project-library-runtime/desktop/native-media-helper-job.js';
import {
	describeFramescaperMediaHostAvailability,
} from './project-library-runtime/desktop/framescaper-media-host-payload.js';
import {
	createNativeMediaHelperWorker,
} from './project-library-runtime/desktop/native-media-helper-worker.js';
import {
	runFramescaperMediaHostSelfTest,
} from './project-library-runtime/desktop/native-media-host-self-test.js';

const SHA256 = /^[a-f\d]{64}$/u;

export function validateNativeMediaHelperProcessConfig(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('A native media helper process config must be a plain record.');
	}
	const fields = ['location', 'expected'].sort();
	const actual = Object.keys(value).sort();
	if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) {
		throw new TypeError('A native media helper process config is invalid.');
	}
	const location = validateLocation(value.location);
	const expected = validateExpectedDescriptor(value.expected);
	return Object.freeze({
		location,
		expected,
	});
}

export async function reopenNativeMediaHelperDescriptor(config) {
	const availability = await describeFramescaperMediaHostAvailability(config.location);
	if (availability.status !== 'available') {
		throw new Error(
			`The utility process could not reopen the media payload (${availability.reason}): ${availability.detail}`,
		);
	}
	assertExpectedDescriptor(config.expected, availability.descriptor);
	return availability.descriptor;
}

function validateLocation(value) {
	const fields = [
		'applicationRoot', 'packaged', 'resourcesPath', 'externalRuntimeRoot', 'platform', 'arch',
	].sort();
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| !exactFields(value, fields)
		|| !absolutePath(value.applicationRoot) || !absolutePath(value.resourcesPath)
		|| !absolutePath(value.externalRuntimeRoot)
		|| typeof value.packaged !== 'boolean'
		|| typeof value.platform !== 'string' || value.platform.length < 3
		|| typeof value.arch !== 'string' || value.arch.length < 3) {
		throw new TypeError('A native media helper process location is invalid.');
	}
	return Object.freeze({
		applicationRoot: value.applicationRoot,
		packaged: value.packaged,
		resourcesPath: value.resourcesPath,
		externalRuntimeRoot: value.externalRuntimeRoot,
		platform: value.platform,
		arch: value.arch,
	});
}

function validateExpectedDescriptor(value) {
	const fields = [
		'target', 'runtime', 'path', 'byteLength', 'sha256',
		'hostVersion', 'ffmpegVersion', 'identity',
	].sort();
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype || !exactFields(value, fields)
		|| !['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(value.target)
		|| typeof value.runtime !== 'string' || value.runtime.length < 5
		|| typeof value.path !== 'string' || !absolutePath(value.path)
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0
		|| typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
		|| !/^\d+\.\d+\.\d+$/u.test(value.hostVersion)
		|| value.ffmpegVersion !== '9.0.1' || !fileIdentity(value.identity)) {
		throw new TypeError('A native media helper process expected descriptor is invalid.');
	}
	return Object.freeze({
		target: value.target, runtime: value.runtime, path: value.path,
		byteLength: value.byteLength, sha256: value.sha256,
		hostVersion: value.hostVersion, ffmpegVersion: value.ffmpegVersion,
		identity: Object.freeze({ dev: value.identity.dev, ino: value.identity.ino }),
	});
}

function assertExpectedDescriptor(expected, actual) {
	if (expected.target !== actual.target || expected.runtime !== actual.runtime
		|| expected.path !== actual.path || expected.byteLength !== actual.byteLength
		|| expected.sha256 !== actual.sha256 || expected.hostVersion !== actual.hostVersion
		|| expected.ffmpegVersion !== actual.ffmpegVersion
		|| expected.identity.dev !== actual.identity.dev || expected.identity.ino !== actual.identity.ino) {
		throw new Error('The utility process reopened a different media-host payload identity.');
	}
}

function exactFields(value, fields) {
	const actual = Object.keys(value).sort();
	return actual.length === fields.length
		&& actual.every((field, index) => field === fields[index]);
}

function absolutePath(value) {
	return typeof value === 'string' && !value.includes('\0') && !value.split(/[\\/]/u).includes('..')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'));
}

function fileIdentity(value) {
	return value && typeof value === 'object' && !Array.isArray(value)
		&& Object.keys(value).sort().join(',') === 'dev,ino'
		&& Number.isSafeInteger(value.dev) && value.dev >= 0
		&& Number.isSafeInteger(value.ino) && value.ino >= 0;
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	void (async () => {
		const argument = process.argv.find((value) => value.startsWith('--framescaper-media-host-config='));
		const config = validateNativeMediaHelperProcessConfig(JSON.parse(
			argument?.slice('--framescaper-media-host-config='.length) ?? 'null',
		));
		const descriptor = await reopenNativeMediaHelperDescriptor(config);
		await runFramescaperMediaHostSelfTest(descriptor);
		const worker = createNativeMediaHelperWorker({
			post: (message) => parentPort.postMessage(message),
			runner: createNativeMediaHelperJobRunner({ descriptor }),
			exit: (code) => process.exit(code),
		});
		parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
	})().catch(() => {
		process.exit(1);
	});
}
