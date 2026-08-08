/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	OpfsSyncWorkerClient,
	type OpfsWorkerLike,
} from '../src/common/editor/storage/opfs-sync-worker-client.ts';

interface PostedMessage extends Record<string, unknown> {
	readonly id: string;
	readonly type: string;
}

class FakeWorker implements OpfsWorkerLike {
	readonly posted: PostedMessage[] = [];
	readonly transfers: readonly Transferable[][] = [];
	terminated = 0;
	readonly #listeners = new Map<string, Set<(event: MessageEvent) => void>>();
	readonly #respond: (message: PostedMessage) => Record<string, unknown> | null;

	constructor(respond: (message: PostedMessage) => Record<string, unknown> | null) {
		this.#respond = respond;
	}

	postMessage(message: PostedMessage, transfer: readonly Transferable[] = []): void {
		this.posted.push(message);
		(this.transfers as Transferable[][]).push([...transfer]);
		const response = this.#respond(message);
		if (response) queueMicrotask(() => this.emit('message', { data: { id: message.id, ...response } }));
	}

	addEventListener(type: string, listener: (event: MessageEvent) => void): void {
		let listeners = this.#listeners.get(type);
		if (!listeners) {
			listeners = new Set();
			this.#listeners.set(type, listeners);
		}
		listeners.add(listener);
	}

	terminate(): void { this.terminated += 1; }

	emit(type: string, event: Record<string, unknown>): void {
		for (const listener of this.#listeners.get(type) ?? []) listener(event as unknown as MessageEvent);
	}
}

test('OPFS sync worker client detects support before issuing bounded operations', async () => {
	const worker = new FakeWorker((message) => {
		if (message.type === 'initialize') return { type: 'result', result: { supported: true } };
		if (message.type === 'read') {
			return {
				type: 'result',
				result: { size: 9, bytes: Uint8Array.of(3, 4, 5).buffer },
			};
		}
		if (message.type === 'snapshot') {
			return { type: 'result', result: { size: 3, file: new Blob(['abc']) } };
		}
		if (message.type === 'open-writer') return { type: 'result', result: { writerId: 'writer-1' } };
		return { type: 'result', result: null };
	});
	const client = new OpfsSyncWorkerClient({ workerFactory: () => worker });
	const directory = { kind: 'directory' } as FileSystemDirectoryHandle;

	assert.equal(await client.initialize(directory), true);
	const read = await client.read(
		'canonical-pcm-chunk-read',
		'source.scpcm',
		{ offset: 4, length: 3 },
	);
	assert.deepEqual([...read.bytes], [3, 4, 5]);
	assert.equal(read.size, 9);
	const snapshot = await client.snapshot('media-asset-chunk-read', 'media.blob');
	assert.equal(await snapshot.text(), 'abc');

	const writer = await client.openWriter('media-asset-chunk-write', 'media.blob');
	await writer.write(Uint8Array.of(7, 8));
	await writer.close();

	assert.deepEqual(worker.posted.map(({ type }) => type), [
		'initialize',
		'read',
		'snapshot',
		'open-writer',
		'write',
		'close-writer',
	]);
	assert.deepEqual(worker.posted[1], {
		id: worker.posted[1].id,
		type: 'read',
		operationId: 'canonical-pcm-chunk-read',
		path: 'source.scpcm',
		offset: 4,
		length: 3,
	});
	assert.equal(worker.transfers[4].length, 1);
	assert.equal((worker.posted[4].bytes as ArrayBuffer).byteLength, 2);

	client.close();
	assert.equal(worker.terminated, 1);
});

test('OPFS sync worker client declines cleanly when capability detection fails', async () => {
	const unsupported = new FakeWorker(() => ({
		type: 'result',
		result: { supported: false },
	}));
	const client = new OpfsSyncWorkerClient({ workerFactory: () => unsupported });

	assert.equal(await client.initialize({} as FileSystemDirectoryHandle), false);
	assert.equal(unsupported.terminated, 1);
	await assert.rejects(
		client.read('media-asset-chunk-read', 'media.blob', { offset: 0, length: 1 }),
		/OPFS synchronous worker is unavailable/u,
	);
});

test('OPFS sync worker client validates the closed operation and range contract before posting', async () => {
	const worker = new FakeWorker(() => ({ type: 'result', result: { supported: true } }));
	const client = new OpfsSyncWorkerClient({ workerFactory: () => worker });
	await client.initialize({} as FileSystemDirectoryHandle);

	await assert.rejects(
		client.read('not-an-operation' as never, 'media.blob', { offset: 0, length: 1 }),
		/known OPFS operation id/u,
	);
	await assert.rejects(
		client.read('derivative-payload-read', '../escape.blob', { offset: 0, length: 1 }),
		/safe OPFS path/u,
	);
	await assert.rejects(
		client.read('derivative-payload-read', 'poster.blob', { offset: -1, length: 1 }),
		/non-negative safe OPFS read range/u,
	);
	assert.equal(worker.posted.length, 1);
	client.close();
});

test('OPFS sync worker client propagates cancellation and terminal worker failure', async () => {
	const worker = new FakeWorker((message) => (
		message.type === 'initialize'
			? { type: 'result', result: { supported: true } }
			: null
	));
	const client = new OpfsSyncWorkerClient({ workerFactory: () => worker });
	await client.initialize({} as FileSystemDirectoryHandle);
	const abort = new AbortController();
	const pending = client.read(
		'media-asset-chunk-read',
		'media.blob',
		{ offset: 0, length: 4 },
		abort.signal,
	);
	abort.abort(new Error('stop read'));
	await assert.rejects(pending, /stop read|cancelled/iu);
	assert.equal(worker.posted.at(-1)?.type, 'cancel');

	const failed = client.read('derivative-payload-read', 'poster.blob', { offset: 0, length: 1 });
	worker.emit('error', { error: new Error('worker crashed') });
	await assert.rejects(failed, /worker crashed/u);
	assert.equal(worker.terminated, 1);
});
