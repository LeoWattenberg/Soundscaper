/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { RetentionSessionGuard } from '../src/common/editor/storage/retention-session-guard.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('another open editor cannot prune PCM held only by this editor undo history', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-undo-${crypto.randomUUID()}`;
	const first = createProjectStore({ indexedDB, databaseName, memoryFallback: false, preferOpfs: false });
	const second = createProjectStore({ indexedDB, databaseName, memoryFallback: false, preferOpfs: false });
	try {
		await first.ready();
		await second.ready();
		const writer = await first.beginSourceWrite('undo-only', {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
		});
		await writer.write([Float32Array.of(0.25)]);
		await writer.commit();

		// The first editor's 200-entry undo stack can still own this source even
		// after its 20 retained project revisions no longer contain the clip.
		const pruneOptions = { minimumAgeMs: 0, now: Date.now() + 2 * 24 * 60 * 60 * 1000 };
		const whileOpen = await second.pruneUnreferencedSources(pruneOptions);
		assert.deepEqual(whileOpen.deletedSourceIds, []);
		assert.equal((await first.getSourceMetadata('undo-only'))?.frameCount, 1);

		await first.close();
		const afterClose = await second.pruneUnreferencedSources(pruneOptions);
		assert.deepEqual(afterClose.deletedSourceIds, ['undo-only']);
		assert.equal(await second.getSourceMetadata('undo-only'), null);
	} finally {
		await first.close();
		await second.close();
	}
});

test('the cross-tab guard also delays OPFS disposal until the other editor closes', async () => {
	const database = createInstrumentedIndexedDB();
	const databaseName = `cross-tab-opfs-${crypto.randomUUID()}`;
	const removedPaths: string[] = [];
	const opfsRoot = {
		async getDirectoryHandle() {
			return { async removeEntry(path: string) { removedPaths.push(path); } };
		},
	} as unknown as FileSystemDirectoryHandle;
	const options = {
		indexedDB: database as unknown as IDBFactory,
		databaseName, memoryFallback: false, preferOpfs: true, opfsRoot,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		database.seedRecord(databaseName, 'sources', {
			id: 'opfs-undo-only', storage: 'opfs', path: 'undo-only.pcm',
			committedAt: '2026-01-01T00:00:00.000Z',
		});
		const pruneOptions = { minimumAgeMs: 0, now: Date.parse('2026-09-24T00:00:00.000Z') };
		assert.deepEqual((await second.pruneUnreferencedSources(pruneOptions)).deletedSourceIds, []);
		assert.deepEqual(removedPaths, []);
		await first.close();
		assert.deepEqual((await second.pruneUnreferencedSources(pruneOptions)).deletedSourceIds, ['opfs-undo-only']);
		assert.deepEqual(removedPaths, ['undo-only.pcm']);
	} finally {
		await first.close();
		await second.close();
	}
});

test('clear refuses another live editor and preserves its PCM before later clearing', async () => {
	const database = createInstrumentedIndexedDB();
	const databaseName = `cross-tab-clear-${crypto.randomUUID()}`;
	const options = {
		indexedDB: database as unknown as IDBFactory,
		databaseName, memoryFallback: false, preferOpfs: false,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		const writer = await first.beginSourceWrite('after-clear-undo', {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
		});
		await writer.write([Float32Array.of(0.5)]);
		await writer.commit();
		await assert.rejects(second.clear(), /another editor session still owns local source history/iu);
		assert.equal((await first.getSourceMetadata('after-clear-undo'))?.frameCount, 1);
		await first.close();
		await second.clear();
		assert.equal(await second.getSourceMetadata('after-clear-undo'), null);
		const next = await second.beginSourceWrite('after-clear-new-source', {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
		});
		await next.write([Float32Array.of(0.75)]);
		await next.commit();
		assert.deepEqual((await second.pruneUnreferencedSources({
			minimumAgeMs: 0, now: Date.now() + 2 * 24 * 60 * 60 * 1000,
		})).deletedSourceIds, ['after-clear-new-source']);
	} finally {
		await first.close();
		await second.close();
	}
});

test('rejected cross-tab clear does not detach OPFS PCM', async () => {
	const database = createInstrumentedIndexedDB();
	const databaseName = `cross-tab-clear-opfs-${crypto.randomUUID()}`;
	const removedPaths: string[] = [];
	const opfsRoot = {
		async getDirectoryHandle() {
			return { async removeEntry(path: string) { removedPaths.push(path); } };
		},
	} as unknown as FileSystemDirectoryHandle;
	const options = {
		indexedDB: database as unknown as IDBFactory,
		databaseName, memoryFallback: false, preferOpfs: true, opfsRoot,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		database.seedRecord(databaseName, 'sources', {
			id: 'opfs-owned-by-first', storage: 'opfs', path: 'first.pcm',
			committedAt: '2026-01-01T00:00:00.000Z',
		});
		await assert.rejects(second.clear(), /another editor session still owns local source history/iu);
		assert.equal(database.recordCount(databaseName, 'sources'), 1);
		assert.deepEqual(removedPaths, []);
		await first.close();
		await second.clear();
		assert.equal(database.recordCount(databaseName, 'sources'), 0);
		assert.deepEqual(removedPaths, ['first.pcm']);
	} finally {
		await first.close();
		await second.close();
	}
});

test('browser lock release proves a crashed session stopped and permits reclamation', async () => {
	const locks = new FakeBrowserLocks();
	await withBrowserLocks(locks, async () => {
		const database = createInstrumentedIndexedDB();
		const databaseName = `cross-tab-crash-${crypto.randomUUID()}`;
		const options = {
			indexedDB: database as unknown as IDBFactory,
			databaseName, memoryFallback: false, preferOpfs: false,
		};
		const survivor = createProjectStore(options);
		const livePeer = createProjectStore(options);
		try {
			await survivor.ready();
			await livePeer.ready();
			const abandonedKey = 'audio-editor-retention-session-v1:abandoned';
			database.seedRecord(databaseName, 'settings', {
				key: abandonedKey,
				value: { version: 1, owner: abandonedKey, webLock: true },
			});
			seedOldSource(database, databaseName, 'held-by-live-peer');
			const pruneOptions = { minimumAgeMs: 0, now: Date.parse('2026-09-24T00:00:00.000Z') };
			assert.deepEqual((await survivor.pruneUnreferencedSources(pruneOptions)).deletedSourceIds, []);
			assert.equal(database.records(databaseName, 'settings').some(({ key }) => key === abandonedKey), false);
			await livePeer.close();
			assert.deepEqual((await survivor.pruneUnreferencedSources(pruneOptions)).deletedSourceIds,
				['held-by-live-peer']);
		} finally {
			await livePeer.close();
			await survivor.close();
		}
	});
});

test('without browser locks, an unprovable crashed session remains protective', async () => {
	await withBrowserLocks(null, async () => {
		const database = createInstrumentedIndexedDB();
		const databaseName = `cross-tab-unprovable-${crypto.randomUUID()}`;
		const store = createProjectStore({
			indexedDB: database as unknown as IDBFactory,
			databaseName, memoryFallback: false, preferOpfs: false,
		});
		try {
			await store.ready();
			const abandonedKey = 'audio-editor-retention-session-v1:abandoned';
			database.seedRecord(databaseName, 'settings', {
				key: abandonedKey,
				value: { version: 1, owner: abandonedKey, webLock: false },
			});
			seedOldSource(database, databaseName, 'unprovable-undo');
			const result = await store.pruneUnreferencedSources({
				minimumAgeMs: 0, now: Date.parse('2026-09-24T00:00:00.000Z'),
			});
			assert.deepEqual(result.deletedSourceIds, []);
			assert.equal(database.recordCount(databaseName, 'sources'), 1);
			await assert.rejects(store.clear(), /another editor session still owns local source history/iu);
			assert.equal(database.recordCount(databaseName, 'sources'), 1);
		} finally {
			await store.close();
		}
	});
});

test('clear can reclaim a crashed browser-lock session before erasing data', async () => {
	await withBrowserLocks(new FakeBrowserLocks(), async () => {
		const backing = createInstrumentedIndexedDB();
		const databaseName = `cross-tab-crash-clear-${crypto.randomUUID()}`;
		const store = createProjectStore({
			indexedDB: backing as unknown as IDBFactory,
			databaseName, memoryFallback: false, preferOpfs: false,
		});
		try {
			await store.ready();
			const abandonedKey = 'audio-editor-retention-session-v1:crashed-clear';
			backing.seedRecord(databaseName, 'settings', {
				key: abandonedKey,
				value: { version: 1, owner: abandonedKey, webLock: true },
			});
			seedOldSource(backing, databaseName, 'stale-clear-source');
			await store.clear();
			assert.equal(backing.recordCount(databaseName, 'sources'), 0);
			assert.equal(backing.records(databaseName, 'settings').some(({ key }) => key === abandonedKey), false);
		} finally {
			await store.close();
		}
	});
});

test('session release rejects and drains an earlier database admission', async () => {
	let resolveDatabase!: (database: IDBDatabase | null) => void;
	const pendingDatabase = new Promise<IDBDatabase | null>((resolve) => { resolveDatabase = resolve; });
	const guard = new RetentionSessionGuard({
		memory: {} as StorageRepositoryPort['memory'],
		database: () => pendingDatabase,
	}, null);
	const opening = guard.database();
	let released = false;
	const closing = guard.release(null).then(() => { released = true; });
	await Promise.resolve();
	assert.equal(released, false);
	resolveDatabase(null);
	await assert.rejects(opening, { code: 'STORE_CLOSED' });
	await closing;
	assert.equal(released, true);
	await assert.rejects(guard.database(), { code: 'STORE_CLOSED' });
});

test('session release waits for marker registration before removing its marker', async () => {
	const backing = createInstrumentedIndexedDB();
	const databaseName = `cross-tab-pending-registration-${crypto.randomUUID()}`;
	const database = await openDatabase(backing as unknown as IDBFactory, databaseName);
	let grant: (() => void) | null = null;
	const locks = {
		request(name: string, _options: unknown, callback: (lock: Lock) => PromiseLike<void>): Promise<void> {
			if (!name.startsWith('audio-editor-retention-session-v1:')) {
				return Promise.resolve(callback({ name, mode: 'exclusive' } as Lock));
			}
			return new Promise<void>((resolve, reject) => {
				grant = () => {
					void Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(resolve, reject);
				};
			});
		},
	} as unknown as LockManager;
	const guard = new RetentionSessionGuard({
		memory: {} as StorageRepositoryPort['memory'],
		database: async () => database,
	}, locks);
	try {
		const opening = guard.database();
		await Promise.resolve();
		assert.ok(grant);
		const closing = guard.release(database);
		(grant as () => void)();
		await assert.rejects(opening, { code: 'STORE_CLOSED' });
		await closing;
		assert.equal(backing.recordCount(databaseName, 'settings'), 0);
	} finally {
		database.close();
	}
});

function seedOldSource(database: ReturnType<typeof createInstrumentedIndexedDB>, databaseName: string, id: string): void {
	database.seedRecord(databaseName, 'sources', {
		id, storage: 'indexeddb-chunks', committedAt: '2026-01-01T00:00:00.000Z',
	});
}

class FakeBrowserLocks {
	readonly #held = new Set<string>();

	async request<Result>(
		name: string,
		options: Readonly<{ readonly ifAvailable?: boolean }>,
		callback: (lock: Lock | null) => Result | PromiseLike<Result>,
	): Promise<Result> {
		if (options.ifAvailable && this.#held.has(name)) return callback(null);
		if (this.#held.has(name)) throw new Error('A browser lock was requested twice.');
		this.#held.add(name);
		try { return await callback({ name, mode: 'exclusive' } as Lock); }
		finally { this.#held.delete(name); }
	}
}

async function withBrowserLocks(
	locks: FakeBrowserLocks | null,
	operation: () => Promise<void>,
): Promise<void> {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true, value: locks ? { locks } : {},
	});
	try { await operation(); }
	finally {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}
