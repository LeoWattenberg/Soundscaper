/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';
import test from 'node:test';
import vm from 'node:vm';

interface ExternalMediaBridge {
	captureExternalMedia(fileOrReadId: File | string): Promise<string | null>;
	resolveExternalMedia(request: { projectReadId: string; sourceId: string }): Promise<Record<string, unknown>>;
}

test('preload captures native dropped File paths with Unicode and leaves generated files embedded', async () => {
	const original = new File(['original'], 'tone.wav');
	const generated = new File(['generated'], 'tone.wav');
	const fixture = await loadPreload((file) => file === original ? '/tmp/München/tone.wav' : '');
	const token = await fixture.bridge.captureExternalMedia(original);
	assert.ok(token);
	assert.deepEqual(JSON.parse(Buffer.from(token, 'base64').toString('utf8')), {
		version: 1, path: '/tmp/München/tone.wav',
	});
	assert.equal(await fixture.bridge.captureExternalMedia(generated), null);
	assert.equal(fixture.invocations.length, 0);
});

test('preload captures native picker grants and resolves only through selected project IDs', async () => {
	const id = 'a'.repeat(64);
	const raw = { id, name: 'original.wav', size: 8, mimeType: 'audio/wav', lastModified: 123,
		readProfile: 'selected-range-v1',
		url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/original.wav` };
	const fixture = await loadPreload(() => '', ['reference-token', { ...raw, path: '/tmp/private.wav' }]);
	assert.equal(await fixture.bridge.captureExternalMedia(id), 'reference-token');
	const resolved = await fixture.bridge.resolveExternalMedia({ projectReadId: id, sourceId: 'audio' });
	assert.deepEqual({ ...resolved }, raw);
	assert.equal(Object.isFrozen(resolved), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel,
		typeof request === 'object' && request !== null ? { ...request } : request]), [
		['soundscaper:v1:external-media:capture', id],
		['soundscaper:v1:external-media:resolve', { projectReadId: id, sourceId: 'audio' }],
	]);
	assert.throws(() => fixture.bridge.captureExternalMedia('/tmp/arbitrary.wav'), /identifier/u);
	assert.throws(() => fixture.bridge.resolveExternalMedia({ projectReadId: '/tmp/project.sscape', sourceId: 'audio' }), /identifier/u);
	assert.equal(fixture.invocations.length, 2);
});

async function loadPreload(pathForFile: (file: File) => string, results: unknown[] = []) {
	let bridge: ExternalMediaBridge | undefined;
	const invocations: [string, unknown][] = [];
	const source = await readDesktopPreloadSource();
	vm.runInNewContext(source, { ArrayBuffer, Object, Promise, RangeError, String, TypeError,
		Uint8Array, URL, TextEncoder, btoa,
		require: () => ({
			webUtils: { getPathForFile: pathForFile },
			contextBridge: { exposeInMainWorld(name: string, value: { v1: ExternalMediaBridge }) {
				if (name === 'scapeDesktop') bridge = value.v1;
			} },
			ipcRenderer: {
				invoke(channel: string, request: unknown) {
					invocations.push([channel, request]); return Promise.resolve(results.shift());
				},
				send() {}, on() {}, removeListener() {},
			},
		}),
	});
	assert.ok(bridge);
	return { bridge, invocations };
}
