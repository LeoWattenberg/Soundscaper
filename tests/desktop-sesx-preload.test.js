/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const SESSION_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(48);
const MEDIA_ID = 'c'.repeat(64);

async function preload(results) {
	let bridge;
	const calls = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, Array, ArrayBuffer, JSON, Number, Object, Promise, RangeError, String,
		TypeError, Uint8Array, URL, Blob, MessageChannel, setTimeout, clearTimeout,
		crypto: webcrypto, structuredClone,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'soundscaperDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) { calls.push([channel, value]); return Promise.resolve(results.shift()); },
				send() {}, on() {}, removeListener() {}, postMessage() {},
			},
		}),
	});
	return { bridge, calls };
}

test('preload accepts pathless SESX media results and rejects path-bearing projections', async () => {
	const descriptor = {
		id: MEDIA_ID, readProfile: 'linked-audio-range-v1', name: 'take.wav',
		url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${MEDIA_ID}/take.wav`,
		size: 12, mimeType: 'audio/wav', lastModified: 0,
	};
	const fixture = await preload([
		{ status: 'selected', mediaRootId: ROOT_ID },
		{ status: 'found', descriptor },
		{ status: 'missing', path: '/private/media.wav' },
		true,
	]);
	assert.equal((await fixture.bridge.chooseSesxMediaFolder({ sessionReadId: SESSION_ID })).mediaRootId, ROOT_ID);
	const found = await fixture.bridge.resolveSesxMedia({ sessionReadId: SESSION_ID, relativePath: 'Audio\\take.wav', mediaRootId: ROOT_ID });
	assert.equal(found.status, 'found');
	assert.equal(found.descriptor.url, descriptor.url);
	await assert.rejects(() => fixture.bridge.resolveSesxMedia({ sessionReadId: SESSION_ID, relativePath: 'take.wav' }), /fields/i);
	assert.equal(await fixture.bridge.releaseSesxSession(SESSION_ID), true);
	assert.deepEqual(fixture.calls.map(([channel]) => channel), [
		'soundscaper:v1:sesx:folder:choose', 'soundscaper:v1:sesx:media:resolve',
		'soundscaper:v1:sesx:media:resolve', 'soundscaper:v1:sesx:session:release',
	]);
});

test('preload rejects absolute and traversal SESX requests before IPC', async () => {
	const fixture = await preload([]);
	for (const relativePath of ['../take.wav', '/secret.wav', 'C:\\secret.wav', '\\\\server\\share.wav', 'x/./take.wav']) {
		assert.throws(() => fixture.bridge.resolveSesxMedia({ sessionReadId: SESSION_ID, relativePath }), /relative|path/i);
	}
	assert.equal(fixture.calls.length, 0);
});
