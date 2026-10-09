/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const TEST_OWNER = Object.freeze({ name: 'renderer-test-owner' });

function createManager(options: Readonly<Record<string, unknown>>): AtomicSaveManager {
	return new AtomicSaveManager(options as unknown as ConstructorParameters<typeof AtomicSaveManager>[0]);
}

test('save-session disposal drains a rejected write and aborts every remaining stage', async () => {
	const writeStarted = deferred();
	const writeGate = deferred();
	const events: string[] = [];
	let handleId = 0;
	const openedPaths: string[] = [];
	const targets = new SaveTargetStore();
	const manager = createManager({
		targets,
		openImpl: async (path: string) => {
			openedPaths.push(path);
			const id = handleId++;
			return {
				async write() {
					events.push(`write-${id}`);
					writeStarted.resolve();
					await writeGate.promise;
					throw new Error('injected write failure');
				},
				async close() { events.push(`close-${id}`); },
			};
		},
		unlinkImpl: async (path: string) => { events.push(`unlink-${openedPaths.indexOf(path)}`); },
	});
	const firstTarget = targets.registerPath('/tmp/first.scape', { owner: TEST_OWNER, purpose: 'project' });
	const secondTarget = targets.registerPath('/tmp/second.scape', { owner: TEST_OWNER, purpose: 'project' });
	const first = await manager.begin({ owner: TEST_OWNER, targetId: firstTarget.id, maximumSize: 1 });
	await manager.begin({ owner: TEST_OWNER, targetId: secondTarget.id, maximumSize: 1 });
	const writing = manager.writeChunk({ owner: TEST_OWNER, writeId: first.writeId, offset: 0, bytes: Uint8Array.of(1) });
	await writeStarted.promise;

	let disposalSettled = false;
	const disposing = Promise.resolve(manager.dispose());
	void disposing.then(() => { disposalSettled = true; });
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for the failing admitted write');
	writeGate.resolve();
	await assert.rejects(writing, /injected write failure/u);
	await disposing;

	assert.deepEqual(events.slice(0, 1), ['write-0']);
	assert.deepEqual(new Set(events.slice(1)), new Set(['close-0', 'close-1', 'unlink-0', 'unlink-1']));
});

test('save-session disposal reports every unacknowledged close and unlink', async () => {
	let handleId = 0;
	let unlinkFailurePath: string | undefined;
	const targets = new SaveTargetStore();
	const manager = createManager({
		targets,
		openImpl: async (path: string) => {
			const id = handleId++;
			if (id === 1) unlinkFailurePath = path;
			return {
				async close() {
					if (id === 0) throw new Error('injected close failure');
				},
			};
		},
		unlinkImpl: async (path: string) => {
			if (path === unlinkFailurePath) throw new Error('injected unlink failure');
		},
	});
	let target = targets.registerPath('/tmp/close-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	target = targets.registerPath('/tmp/unlink-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });

	await assert.rejects(Promise.resolve(manager.dispose()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /save staging cleanup failed/u);
		assert.deepEqual(
			new Set(error.errors.map((failure: unknown) => failure instanceof Error ? failure.message : String(failure))),
			new Set(['Could not close the temporary save file', 'Could not remove the temporary save file']),
		);
		return true;
	});
	assert.throws(
		() => targets.registerPath('/tmp/after-cleanup-failure.scape', { owner: TEST_OWNER, purpose: 'project' }),
		/disposed/u,
	);
});

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
