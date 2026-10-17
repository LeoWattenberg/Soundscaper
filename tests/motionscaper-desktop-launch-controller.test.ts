/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installMotionscaperDesktopLaunch } from '../src/motionscaper/editor-desktop-launch.ts';
import type { MotionDesktopFiles } from '../src/motionscaper/desktop-file-contract.ts';
function fixture() {
	let listener = () => undefined as void; let takes = 0; const acknowledged: string[] = [], released: string[] = [];
	const queue = ['cold', 'warm'];
	const files: MotionDesktopFiles = { selectOpen: async () => null, read: async () => new Uint8Array(), release: async ({ token }) => { released.push(token); }, bindOpened: async () => undefined,
		beginSave: async () => null, write: async () => undefined, commit: async () => { throw new Error('Not a save.'); }, cancel: async () => undefined };
	const launch = { take: async () => { takes++; const token = queue.shift(); return token ? { token, name: `${token}.mscape`, byteLength: 1 } : null; },
		acknowledge: async ({ token }: { token: string }) => { acknowledged.push(token); }, onPending: (callback: () => void) => { listener = callback; return () => { listener = () => undefined; }; } };
	return { files, launch, pending: () => listener(), takes: () => takes, acknowledged, released };
}
async function turn() { await new Promise<void>(resolve => setImmediate(resolve)); }
test('M01 native cold launch wakes without an event and serializes warm files until reviewed capability release', async () => {
	const f = fixture(), opened: string[] = []; let complete = () => undefined as void;
	const installation = installMotionscaperDesktopLaunch({ ...f, canOpen: () => true, onError: error => { throw error; }, onOpen: async selection => {
		opened.push(selection.name); await new Promise<void>(resolve => { complete = resolve; }); await selection.release();
	} });
	await turn(); assert.deepEqual(opened, ['cold.mscape']); f.pending(); await turn(); assert.equal(f.takes(), 1);
	complete(); await turn(); assert.deepEqual(opened, ['cold.mscape', 'warm.mscape']); assert.deepEqual(f.acknowledged, ['cold']);
	complete(); await turn(); assert.deepEqual(f.acknowledged, ['cold', 'warm']); installation.dispose();
});
test('M01 native launch waits for an existing authoring dialog without taking or discarding its file', async () => {
	const f = fixture(); let available = false; const opened: string[] = [];
	const installation = installMotionscaperDesktopLaunch({ ...f, canOpen: () => available, onError: error => { throw error; }, onOpen: async selection => { opened.push(selection.name); await selection.release(); } });
	await turn(); assert.equal(f.takes(), 0); f.pending(); await turn(); assert.equal(f.takes(), 0);
	available = true; installation.wake(); await turn(); assert.deepEqual(opened, ['cold.mscape', 'warm.mscape']); assert.deepEqual(f.released, ['cold', 'warm']); installation.dispose();
});
test('M01 native launch disposal releases an already-taken capability without opening a detached runtime', async () => {
	const f = fixture(); let resolve!: (value: { token: string; name: string; byteLength: number }) => void; let opened = 0;
	const launch = { ...f.launch, take: () => new Promise<{ token: string; name: string; byteLength: number }>(done => { resolve = done; }) };
	const installation = installMotionscaperDesktopLaunch({ files: f.files, launch, canOpen: () => true, onError: error => { throw error; }, onOpen: async () => { opened++; } });
	await turn(); installation.dispose(); resolve({ token: 'detached', name: 'detached.mscape', byteLength: 1 }); await turn();
	assert.equal(opened, 0); assert.deepEqual(f.acknowledged, ['detached']);
});

test('M01 a pending event arriving during an empty take is drained without another event', async () => {
	const f = fixture(); let resolve!: (value: null) => void, first = true; const opened: string[] = [];
	const launch = { ...f.launch, take: async () => { if (first) { first = false; return new Promise<null>(done => { resolve = done; }); } return f.launch.take(); } };
	const installation = installMotionscaperDesktopLaunch({ files: f.files, launch, canOpen: () => true, onError: error => { throw error; }, onOpen: async selection => { opened.push(selection.name); await selection.release(); } });
	await turn(); f.pending(); resolve(null); await turn(); assert.deepEqual(opened, ['cold.mscape', 'warm.mscape']); installation.dispose();
});
