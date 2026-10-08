/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';
import test from 'node:test';
import vm from 'node:vm';

type OriginalFile = Readonly<{ id: string; name: string }>;
type Bridge = {
	chooseFiles(options: { purpose: string }): Promise<ReadonlyArray<{ originalFile?: OriginalFile }>>;
	prepareOriginalOverwrite(id: string): Promise<OriginalFile>;
	releaseOriginalFile(id: string): Promise<boolean>;
};

const ID = 'a'.repeat(48);
const READ_ID = 'b'.repeat(64);
const originalFile = { id: ID, name: 'original.wav' };
const descriptor = {
	id: READ_ID, name: 'original.wav', readProfile: 'selected-range-v1',
	url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${READ_ID}/original.wav`,
	size: 24, mimeType: 'audio/wav', lastModified: 0, originalFile,
};

async function fixture(results: unknown[] = []) {
	let bridge: Bridge | undefined;
	const calls: unknown[][] = [];
	const source = await readDesktopPreloadSource();
	vm.runInNewContext(source, {
		ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld: (name: string, value: { v1: Bridge }) => { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: { invoke: (channel: string, value: unknown) => { calls.push([channel, value]); return Promise.resolve(results.shift()); }, send: () => {}, on: () => {}, removeListener: () => {} },
		}),
		process: { argv: [] },
	});
	assert.ok(bridge);
	return { bridge, calls };
}

test('preload preserves frozen original metadata and scopes overwrite IPC to opaque ids', async () => {
	const entry = await fixture([[descriptor], originalFile, true]);
	const received = (await entry.bridge.chooseFiles({ purpose: 'audio' }))[0]!.originalFile!;
	assert.deepEqual({ ...received }, originalFile);
	assert.equal(Object.isFrozen(received), true);
	assert.deepEqual({ ...await entry.bridge.prepareOriginalOverwrite(ID) }, originalFile);
	assert.equal(await entry.bridge.releaseOriginalFile(ID), true);
	assert.deepEqual(entry.calls.slice(1), [['soundscaper:v1:original-file:prepare-overwrite', ID], ['soundscaper:v1:original-file:release', ID]]);
	assert.throws(() => entry.bridge.prepareOriginalOverwrite('/tmp/original.wav'), /opaque identifier/iu);
});

test('preload rejects forged original descriptors and malformed overwrite responses', async () => {
	for (const original of [{ ...originalFile, path: '/tmp/original.wav' }, { ...originalFile, name: 'other.wav' }, { ...originalFile, id: '/tmp/original.wav' }]) {
		const entry = await fixture([[{ ...descriptor, originalFile: original }]]);
		await assert.rejects(entry.bridge.chooseFiles({ purpose: 'audio' }), /original|opaque identifier/iu);
	}
	const entry = await fixture([{ ...originalFile, path: '/tmp/original.wav' }, 'true']);
	await assert.rejects(entry.bridge.prepareOriginalOverwrite(ID), /original/iu);
	await assert.rejects(entry.bridge.releaseOriginalFile(ID), /boolean/iu);
});
