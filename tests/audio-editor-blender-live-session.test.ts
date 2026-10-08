/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlenderLiveSession } from '../src/common/editor/controller/export/blender-live-session.ts';
import type { BlenderBridge } from '../src/common/editor/blender-contract.ts';
import type { BlenderPublishRequest } from '../src/common/editor/controller/export/blender-publication.ts';

function fixture() {
	let project: { id: string; revision: number } | null = { id: 'a', revision: 1 };
	let listener: (() => void) | null = null;
	let scheduled: (() => void) | null = null;
	const calls: string[] = [];
	const requests: BlenderPublishRequest[] = [];
	const bridge: BlenderBridge = { select: async ({ live }) => { calls.push(`select:${String(live)}`); return { sessionId: 'session' }; },
		begin: async () => ({ publicationId: 'publication' }), write: async () => undefined,
		commit: async () => ({ revision: 1 }), abort: async () => undefined,
		stop: async () => { calls.push('stop'); } };
	const options = { bridge, getSnapshot: () => ({ project }),
		subscribe: (next: () => void) => { listener = next; calls.push('subscribe'); return () => { listener = null; calls.push('unsubscribe'); }; },
		publish: async (request: BlenderPublishRequest) => { requests.push(request); return { revision: 1 }; },
		onError: (error: unknown) => { throw error; },
		schedule: (callback: () => void) => { scheduled = callback; return () => { scheduled = null; }; } };
	return { options, calls, requests,
		change(next: typeof project) { project = next; listener?.(); },
		async tick() { const callback = scheduled; scheduled = null; callback?.(); await new Promise<void>((resolve) => setImmediate(resolve)); } };
}

test('live Blender sync subscribes only after opt-in and debounces document edits', async () => {
	const f = fixture();
	const session = createBlenderLiveSession(f.options);
	assert.deepEqual(f.calls, []);
	assert.equal(await session.start(), true);
	assert.equal(session.active(), true);
	f.change({ id: 'a', revision: 2 });
	f.change({ id: 'a', revision: 3 });
	assert.deepEqual(f.requests.map(({ revision }) => revision), [1]);
	await f.tick();
	assert.deepEqual(f.requests.map(({ revision }) => revision), [1, 3]);
	f.change({ id: 'a', revision: 3 });
	await f.tick();
	assert.equal(f.requests.length, 2, 'presentation snapshots do not republish the document');
	await session.dispose();
	await session.dispose();
	assert.deepEqual(f.calls, ['select:true', 'subscribe', 'unsubscribe', 'stop']);
});

test('live Blender sync aborts superseded rendering and serializes replacement snapshots', async () => {
	const f = fixture();
	let release: (() => void) | undefined;
	const session = createBlenderLiveSession({ ...f.options,
		publish: async (request) => {
			f.requests.push(request);
			if (request.revision === 2) await new Promise<void>((resolve) => { release = resolve; });
			request.signal?.throwIfAborted();
			return { revision: request.revision };
		} });
	await session.start();
	f.change({ id: 'a', revision: 2 });
	await f.tick();
	f.change({ id: 'a', revision: 3 });
	assert.equal(f.requests[1]?.signal?.aborted, true);
	await f.tick();
	assert.equal(f.requests.length, 2);
	release?.();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(f.requests.map(({ revision }) => revision), [1, 2, 3]);
	await session.stop();
});

test('changing projects stops Blender sync and removes the subscription', async () => {
	const f = fixture();
	const session = createBlenderLiveSession(f.options);
	await session.start();
	f.change({ id: 'b', revision: 1 });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(session.active(), false);
	assert.deepEqual(f.calls.slice(-2), ['unsubscribe', 'stop']);
	assert.equal(f.requests.length, 1);
});

test('one-shot export uses the current revision after the folder chooser', async () => {
	const f = fixture();
	let choose: ((value: { sessionId: string }) => void) | undefined;
	const session = createBlenderLiveSession({ ...f.options, bridge: { ...f.options.bridge,
		select: () => new Promise((resolve) => { choose = resolve; }) } });
	const exportPromise = session.export();
	f.change({ id: 'a', revision: 2 });
	choose?.({ sessionId: 'export' });
	assert.equal(await exportPromise, true);
	assert.equal(f.requests[0]?.revision, 2);
	await session.dispose();
});

test('disposing or switching projects during the export chooser releases the session without rendering', async () => {
	for (const dispose of [false, true]) {
		const f = fixture();
		let choose: ((value: { sessionId: string }) => void) | undefined;
		const session = createBlenderLiveSession({ ...f.options, bridge: { ...f.options.bridge,
			select: () => new Promise((resolve) => { choose = resolve; }) } });
		const exportPromise = session.export();
		assert.equal(await session.start(), false, 'a pending export excludes a second chooser');
		const disposal = dispose ? session.dispose() : Promise.resolve();
		if (!dispose) f.change({ id: 'b', revision: 1 });
		choose?.({ sessionId: 'export' });
		assert.equal(await exportPromise, false);
		await disposal;
		assert.equal(f.requests.length, 0);
		assert.deepEqual(f.calls, ['stop']);
	}
});

test('disposing during one-shot export aborts the render and waits for its cleanup', async () => {
	const f = fixture();
	let release: (() => void) | undefined;
	const session = createBlenderLiveSession({ ...f.options, publish: async (request) => {
		f.requests.push(request);
		await new Promise<void>((resolve) => { release = resolve; });
		request.signal?.throwIfAborted();
		return { revision: 1 };
	} });
	const exportPromise = session.export();
	await new Promise<void>((resolve) => setImmediate(resolve));
	const disposal = session.dispose();
	assert.equal(f.requests[0]?.signal?.aborted, true);
	assert.deepEqual(f.calls, ['select:false']);
	release?.();
	await assert.rejects(exportPromise, { name: 'AbortError' });
	await disposal;
	assert.deepEqual(f.calls, ['select:false', 'stop']);
});
