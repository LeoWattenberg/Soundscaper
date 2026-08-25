/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const STATUS = Object.freeze({
	state: 'ready', location: '/opt/homebrew/bin/ffmpeg', version: '9.0.1',
	detail: 'Compatible.', canInstall: true, canBrowse: true, canClear: true,
});

test('sandbox preload exposes five argument-free FFmpeg preference actions', async () => {
	const calls = [];
	const bridge = await preloadBridge((channel, ...args) => {
		calls.push([channel, args]);
		return Promise.resolve(STATUS);
	});
	for (const [method, channel] of [
		['getExternalFfmpegStatus', 'soundscaper:v1:ffmpeg:status'],
		['chooseExternalFfmpeg', 'soundscaper:v1:ffmpeg:choose'],
		['clearExternalFfmpeg', 'soundscaper:v1:ffmpeg:clear'],
		['rescanExternalFfmpeg', 'soundscaper:v1:ffmpeg:rescan'],
		['installExternalFfmpeg', 'soundscaper:v1:ffmpeg:install'],
	]) {
		const result = await bridge.v1[method]();
		assert.deepEqual({ ...result }, STATUS);
		assert.equal(Object.isFrozen(result), true);
		assert.deepEqual(calls.at(-1), [channel, []]);
	}
});

test('sandbox preload rejects malformed or path-smuggling FFmpeg statuses', async () => {
	for (const malicious of [
		{ ...STATUS, extra: 'authority' },
		{ ...STATUS, state: 'trusted' },
		{ ...STATUS, location: '/tools/ffmpeg\0--enable-network' },
		{ ...STATUS, canInstall: 1 },
	]) {
		const bridge = await preloadBridge(() => Promise.resolve(malicious));
		await assert.rejects(bridge.v1.getExternalFfmpegStatus(), /external FFmpeg status/iu);
	}
});

async function preloadBridge(invoke) {
	const exposed = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value); } },
				ipcRenderer: { invoke, send() {}, on() {}, removeListener() {} },
			};
		},
	});
	return exposed.get('soundscaperDesktop');
}
