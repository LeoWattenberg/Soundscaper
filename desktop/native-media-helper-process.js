/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utility-process entry for the isolated Framescaper media host. */

import {
	createNativeMediaHelperJobRunner,
} from './project-library-runtime/desktop/native-media-helper-job.js';
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
	const fields = [
		'target', 'runtime', 'path', 'byteLength', 'sha256',
		'hostVersion', 'ffmpegVersion', 'identity',
	].sort();
	const actual = Object.keys(value).sort();
	if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])
		|| !['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(value.target)
		|| typeof value.runtime !== 'string' || value.runtime.length < 5
		|| typeof value.path !== 'string' || !absolutePath(value.path)
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0
		|| typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
		|| !/^\d+\.\d+\.\d+$/u.test(value.hostVersion)
		|| value.ffmpegVersion !== '9.0.1'
		|| !fileIdentity(value.identity)) {
		throw new TypeError('A native media helper process config is invalid.');
	}
	return Object.freeze({
		target: value.target,
		runtime: value.runtime,
		path: value.path,
		byteLength: value.byteLength,
		sha256: value.sha256,
		hostVersion: value.hostVersion,
		ffmpegVersion: value.ffmpegVersion,
		identity: Object.freeze({ dev: value.identity.dev, ino: value.identity.ino }),
	});
}

function absolutePath(value) {
	return !value.includes('\0') && !value.split(/[\\/]/u).includes('..')
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
		const descriptor = validateNativeMediaHelperProcessConfig(JSON.parse(
			argument?.slice('--framescaper-media-host-config='.length) ?? 'null',
		));
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
