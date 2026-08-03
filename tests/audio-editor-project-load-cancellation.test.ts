/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';

class ReadTrackingMap extends Map<string, unknown> {
	reads = 0;

	override get(key: string): unknown {
		this.reads += 1;
		return super.get(key);
	}
}

test('a pre-aborted memory project load rejects its exact reason without reading storage', async () => {
	const projects = new ReadTrackingMap([['memory-project', { id: 'memory-project', revision: 1 }]]);
	let databaseCalls = 0;
	const repository = new ProjectRepository(memoryPort(projects, async () => {
		databaseCalls += 1;
		return null;
	}), 2);
	const controller = new AbortController();
	const reason = new Error('cancel memory project load');
	controller.abort(reason);

	await assert.rejects(
		repository.load('memory-project', { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(databaseCalls, 0);
	assert.equal(projects.reads, 0);
});

test('project load promptly rejects while an abort-ignoring database lookup remains pending', async () => {
	const database = deferred<IDBDatabase | null>();
	const repository = new ProjectRepository(memoryPort(new ReadTrackingMap(), () => database.promise), 2);
	const controller = new AbortController();
	const reason = new Error('cancel pending project database lookup');
	const loading = repository.load('pending-project', { signal: controller.signal });
	controller.abort(reason);

	const observed = await settlePromptly(loading);
	database.resolve(null);
	await loading.catch(() => undefined);

	if (observed === TIMED_OUT) assert.fail('project load did not reject promptly after cancellation');
	assert.equal(observed.status, 'rejected');
	assert.equal(observed.reason, reason);
});

test('cancelling projects.get drains both read and transaction before exact rejection', async () => {
	for (const firstRelease of ['request', 'transaction'] as const) {
		const controlled = controlledProjectRead();
		const repository = new ProjectRepository(memoryPort(
			new ReadTrackingMap(),
			async () => controlled.database,
		), 2);
		const controller = new AbortController();
		const reason = new Error(`cancel IndexedDB project get (${firstRelease} first)`);
		const loading = repository.load('indexeddb-project', { signal: controller.signal });
		await controlled.getStarted;

		controller.abort(reason);
		assert.equal(controlled.abortCalls, 1);
		if (firstRelease === 'request') controlled.releaseRequestAbort();
		else controlled.releaseTransactionAbort();
		assert.equal(controlled.activeTransactions, firstRelease === 'request' ? 1 : 0);
		assert.equal(
			await settlePromptly(loading),
			TIMED_OUT,
			`load must not reject after only the ${firstRelease} abort event`,
		);

		if (firstRelease === 'request') controlled.releaseTransactionAbort();
		else controlled.releaseRequestAbort();
		await assert.rejects(
			loading,
			(error: unknown) => error === reason,
		);
		assert.equal(controlled.activeTransactions, 0);
	}
});

const TIMED_OUT = Symbol('timed out');

type Settlement<Value> = Readonly<
	| { status: 'fulfilled'; value: Value }
	| { status: 'rejected'; reason: unknown }
>;

function settlePromptly<Value>(promise: Promise<Value>): Promise<Settlement<Value> | typeof TIMED_OUT> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(TIMED_OUT), 50);
		void promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(Object.freeze({ status: 'fulfilled', value }));
			},
			(reason: unknown) => {
				clearTimeout(timer);
				resolve(Object.freeze({ status: 'rejected', reason }));
			},
		);
	});
}

function deferred<Value>(): Readonly<{
	promise: Promise<Value>;
	resolve(value: Value): void;
}> {
	let resolvePromise: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>((resolve) => { resolvePromise = resolve; });
	return Object.freeze({
		promise,
		resolve(value: Value) {
			if (!resolvePromise) throw new Error('Deferred resolver is unavailable.');
			resolvePromise(value);
		},
	});
}

function memoryPort(
	projects: Map<string, unknown>,
	database: () => Promise<IDBDatabase | null>,
): Readonly<{
	memory: EditorMemoryDatabase;
	database: () => Promise<IDBDatabase | null>;
}> {
	return Object.freeze({
		memory: {
			projects,
			revisions: new Map(),
			settings: new Map(),
			analysis: new Map(),
			sources: new Map(),
			sourceChunks: new Map(),
			mediaAssets: new Map(),
			mediaAssetChunks: new Map(),
			mediaAssetStaging: new Map(),
			videoDerivatives: new Map(),
			linkedVideoOriginalBindings: new Map(),
			linkedOriginalProvisionalRoots: new Map(),
		},
		database,
	});
}

function controlledProjectRead(): Readonly<{
	database: IDBDatabase;
	getStarted: Promise<void>;
	readonly abortCalls: number;
	readonly activeTransactions: number;
	releaseRequestAbort(): void;
	releaseTransactionAbort(): void;
}> {
	const started = deferred<void>();
	let abortCalls = 0;
	let activeTransactions = 0;
	let requestReleased = false;
	let transactionReleased = false;
	const requestState: {
		result?: unknown;
		error: DOMException | null;
		onsuccess: (() => void) | null;
		onerror: (() => void) | null;
	} = { error: null, onsuccess: null, onerror: null };
	const transactionState: {
		error: DOMException | null;
		oncomplete: (() => void) | null;
		onabort: (() => void) | null;
		onerror: (() => void) | null;
		abort(): void;
		objectStore(name: string): IDBObjectStore;
	} = {
		error: null,
		oncomplete: null,
		onabort: null,
		onerror: null,
		abort() { abortCalls += 1; },
		objectStore(name: string) {
			assert.equal(name, 'projects');
			return {
				get(key: IDBValidKey) {
					assert.equal(key, 'indexeddb-project');
					started.resolve();
					return requestState as unknown as IDBRequest<unknown>;
				},
			} as IDBObjectStore;
		},
	};
	const database = {
		transaction(storeName: string, mode?: IDBTransactionMode) {
			assert.equal(storeName, 'projects');
			assert.equal(mode, 'readonly');
			activeTransactions += 1;
			return transactionState as unknown as IDBTransaction;
		},
	} as unknown as IDBDatabase;
	return Object.freeze({
		database,
		getStarted: started.promise,
		get abortCalls() { return abortCalls; },
		get activeTransactions() { return activeTransactions; },
		releaseRequestAbort() {
			if (requestReleased) throw new Error('Controlled project request was already released.');
			if (!abortCalls) throw new Error('The transaction was not aborted before release.');
			requestReleased = true;
			requestState.error = new DOMException('The request was aborted.', 'AbortError');
			requestState.onerror?.();
		},
		releaseTransactionAbort() {
			if (transactionReleased) throw new Error('Controlled project transaction was already released.');
			if (!abortCalls) throw new Error('The transaction was not aborted before release.');
			transactionReleased = true;
			transactionState.error = new DOMException('The transaction was aborted.', 'AbortError');
			activeTransactions -= 1;
			transactionState.onabort?.();
		},
	});
}
