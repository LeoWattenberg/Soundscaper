/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createOperatingSystemAudioCodecElectronSpawn,
} from '../desktop/os-audio-codec-electron-spawn.mjs';

test('Electron adapter forks only the reviewed helper and maps its closed channel', () => {
	const calls = [];
	const listeners = new Map();
	const child = {
		postMessage: (message) => calls.push(['post', message]),
		on: (event, listener) => { listeners.set(event, listener); },
		off: (event, listener) => {
			assert.equal(listeners.get(event), listener);
			listeners.delete(event);
		},
		kill: () => { calls.push(['kill']); },
	};
	const spawn = createOperatingSystemAudioCodecElectronSpawn({
		helperPath: '/app/desktop/os-audio-codec-helper-process.js',
		fork: (modulePath, arguments_, options) => {
			calls.push(['fork', modulePath, arguments_, options]);
			return child;
		},
	});
	const configuration = {
		contractVersion: 1, target: 'mac-arm64', addonPath: '/runtime/addon.node',
		addonSha256: 'a'.repeat(64),
	};
	const channel = spawn(configuration);
	assert.deepEqual(calls, [[
		'fork', '/app/desktop/os-audio-codec-helper-process.js',
		[`--os-audio-codec-config=${JSON.stringify(configuration)}`],
		{ serviceName: 'soundscaper-os-audio-codec-helper' },
	]]);
	const messages = [];
	const exits = [];
	const removeMessage = channel.onMessage((message) => messages.push(message));
	const removeExit = channel.onExit((code) => exits.push(code));
	listeners.get('message')({ ready: true });
	listeners.get('exit')(undefined);
	assert.deepEqual(messages, [{ ready: true }]);
	assert.deepEqual(exits, [null]);
	channel.postMessage({ job: true });
	channel.kill();
	removeMessage();
	removeExit();
	assert.deepEqual(calls.slice(1), [['post', { job: true }], ['kill']]);
	assert.equal(listeners.size, 0);
});

test('Electron adapter rejects macOS x64 and inexact configurations before fork', () => {
	let forks = 0;
	const spawn = createOperatingSystemAudioCodecElectronSpawn({
		helperPath: '/app/desktop/os-audio-codec-helper-process.js',
		fork: () => { forks += 1; throw new Error('must not fork'); },
	});
	assert.throws(() => spawn({
		contractVersion: 1, target: 'mac-x64', addonPath: '/runtime/addon.node',
		addonSha256: 'a'.repeat(64),
	}), /target/iu);
	assert.throws(() => spawn({
		contractVersion: 1, target: 'mac-arm64', addonPath: '/runtime/addon.node',
		addonSha256: 'a'.repeat(64), extra: true,
	}), /shape/iu);
	assert.equal(forks, 0);
});
