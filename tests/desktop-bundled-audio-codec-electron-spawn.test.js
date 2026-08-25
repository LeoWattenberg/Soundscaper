/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBundledAudioCodecElectronSpawn,
} from '../desktop/bundled-audio-codec-electron-spawn.mjs';

const configuration = Object.freeze({
	contractVersion: 1, target: 'linux-x64', codec: 'flac',
	runtimeRoot: '/app/desktop/project-library-runtime',
	moduleBytes: 10_000, moduleSha256: 'a'.repeat(64),
	dependencies: Object.freeze([Object.freeze({
		path: 'desktop/desktop-audio-codec-operation-contract.js',
		byteLength: 1_000, sha256: 'c'.repeat(64),
	})]),
	wasmBytes: 153_044, wasmSha256: 'b'.repeat(64),
});

test('Electron adapter forks only the fixed bundled helper with exact configuration', () => {
	const calls = [];
	const subscriptions = [];
	const child = {
		postMessage(message) { calls.push(['post', message]); },
		on(event, listener) { subscriptions.push([event, listener]); },
		off(event, listener) { calls.push(['off', event, listener]); },
		kill() { calls.push(['kill']); },
	};
	const spawn = createBundledAudioCodecElectronSpawn({
		helperPath: '/app/desktop/project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
		fork(path, arguments_, options) {
			calls.push(['fork', path, arguments_, options]);
			return child;
		},
	});
	const wrapped = spawn(configuration);
	assert.deepEqual(calls[0], [
		'fork', '/app/desktop/project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
		[`--bundled-audio-codec-config=${JSON.stringify(configuration)}`],
		{ serviceName: 'soundscaper-bundled-audio-codec-helper' },
	]);
	wrapped.postMessage({ type: 'job' });
	const removeMessage = wrapped.onMessage(() => undefined);
	const removeExit = wrapped.onExit(() => undefined);
	assert.deepEqual(subscriptions.map(([event]) => event), ['message', 'exit']);
	removeMessage();
	removeExit();
	wrapped.kill();
	assert.equal(calls.some(([kind]) => kind === 'kill'), true);
});

test('Electron adapter rejects inexact configuration and child surfaces before fork authority', () => {
	let forks = 0;
	const spawn = createBundledAudioCodecElectronSpawn({
		helperPath: '/app/helper.js',
		fork() {
			forks += 1;
			return { postMessage() {}, on() {}, off() {}, kill() {} };
		},
	});
	assert.throws(() => spawn({ ...configuration, codec: 'ffmpeg' }), /codec|configuration/iu);
	assert.throws(() => spawn({ ...configuration, extra: true }), /inexact shape/iu);
	assert.equal(forks, 0);
	assert.throws(() => createBundledAudioCodecElectronSpawn({
		helperPath: 'relative.js', fork() {},
	}), /spawn options/iu);
	const invalidChild = createBundledAudioCodecElectronSpawn({
		helperPath: '/app/helper.js', fork: () => ({}),
	});
	assert.throws(() => invalidChild(configuration), /utility process/iu);
});
