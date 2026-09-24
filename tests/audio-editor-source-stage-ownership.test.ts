/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import type { AudioSourceStageReceipt } from '../src/common/editor/storage/source-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb', 'opfs'] as const) {
	test(`${backend} source stages expose exact restart-safe ownership receipts`, async () => {
		const files = new Map<string, Blob>();
		const store = createProjectStore({
			indexedDB: backend === 'memory' ? null : createInstrumentedIndexedDB(),
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs',
			databaseName: uniqueName(`source-stage-${backend}`),
			opfsRoot: backend === 'opfs' ? createOpfsDirectory(files) : null,
		});
		const receipt = store.sourceRepository.createStageReceipt('cycle-source') as AudioSourceStageReceipt;
		assert.equal(Object.isFrozen(receipt), true);
		assert.equal(receipt.version, 1);
		assert.equal(receipt.sourceId, 'cycle-source');
		assert.match(receipt.sourceToken, /^cycle-source:pending:write-/u);
		assert.equal(files.size, 0, 'planning exact stage ownership has no storage side effect');
		const writer = await store.sourceRepository.beginOwnedStage(receipt, {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
		});
		assert.deepEqual(writer.stageReceipt, receipt);

		await writer.write([Float32Array.of(0.1, 0.2, 0.3, 0.4)]);
		assert.equal(await store.sourceRepository.discardStageIfCurrent(receipt), true);
		assert.equal(await store.sourceRepository.discardStageIfCurrent(receipt), true, 'restart cleanup is idempotent');
		assert.equal(await store.getSourceMetadata('cycle-source'), null);
		assert.equal(store.memory.sourceChunks.size, 0);
		assert.equal(files.size, 0);
		await writer.abort();
	});

	test(`${backend} discarding a source stage prevents its writer from publishing missing PCM`, async () => {
		const files = new Map<string, Blob>();
		const store = createProjectStore({
			indexedDB: backend === 'memory' ? null : createInstrumentedIndexedDB(),
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs',
			databaseName: uniqueName(`source-stage-discard-${backend}`),
			opfsRoot: backend === 'opfs' ? createOpfsDirectory(files) : null,
		});
		const receipt = store.sourceRepository.createStageReceipt('discarded-source');
		const writer = await store.sourceRepository.beginOwnedStage(receipt, {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
		});
		try {
			await writer.write([Float32Array.of(0.25, 0.5)]);
			assert.equal(await store.sourceRepository.discardStageIfCurrent(receipt), true);
			await assert.rejects(writer.commit(), /staging lease|invalidated/iu);
			assert.equal(await store.getSourceMetadata('discarded-source'), null);
			assert.equal(store.memory.sourceChunks.size, 0);
			assert.equal(files.size, 0);
		} finally {
			await writer.abort();
			await store.close();
		}
	});

	test(`${backend} a discarded receipt cannot reopen a source stage`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'memory' ? null : createInstrumentedIndexedDB(),
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: uniqueName(`source-stage-reopen-${backend}`),
		});
		try {
			const receipt = store.sourceRepository.createStageReceipt('revoked-source');
			assert.equal(await store.sourceRepository.discardStageIfCurrent(receipt), true);
			await assert.rejects(
				store.sourceRepository.beginOwnedStage(receipt, { sampleRate: 48_000 }),
				/staging lease|invalidated/iu,
			);
			assert.equal(await store.getSourceMetadata('revoked-source'), null);
		} finally {
			await store.close();
		}
	});
}

test('concurrent source commit and stage discard leave one consistent winner', async () => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: uniqueName('source-stage-commit-race'),
	});
	try {
		const receipt = store.sourceRepository.createStageReceipt('racing-source');
		const writer = await store.sourceRepository.beginOwnedStage(receipt, {
			sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
		});
		await writer.write([Float32Array.of(0.25, 0.5)]);
		const [commit, discard] = await Promise.allSettled([
			writer.commit(), store.sourceRepository.discardStageIfCurrent(receipt),
		]);
		if (discard.status !== 'fulfilled') throw discard.reason;
		if (commit.status === 'fulfilled') {
			assert.equal(discard.value, false);
			assert.deepEqual(await store.getSourceMetadata('racing-source'), commit.value);
			assert.equal((await store.readSourceChunk('racing-source', 0))?.channels[0]?.[0], 0.25);
		} else {
			assert.match(String(commit.reason), /staging lease|invalidated/iu);
			assert.equal(discard.value, true);
			assert.equal(await store.getSourceMetadata('racing-source'), null);
		}
	} finally {
		await store.close();
	}
});

test('a stage receipt can never delete committed or replacement source ownership', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueName('source-stage-committed'),
	});
	const receipt = store.sourceRepository.createStageReceipt('cycle-source') as AudioSourceStageReceipt;
	const writer = await store.sourceRepository.beginOwnedStage(receipt, {
		sampleRate: 48_000, channelCount: 1, chunkFrames: 2,
	});
	await writer.write([Float32Array.of(0.25, 0.5)]);
	const committed = await writer.commit({}, { ifAbsent: true });

	assert.equal(await store.sourceRepository.discardStageIfCurrent(receipt), false);
	assert.deepEqual(await store.getSourceMetadata('cycle-source'), committed);
	assert.equal(store.memory.sourceChunks.size, 1);

	const forged = { ...receipt, sourceToken: 'foreign-source:pending:write-forged' };
	await assert.rejects(
		store.sourceRepository.discardStageIfCurrent(forged),
		/does not belong to sourceId/u,
	);
	assert.deepEqual(await store.getSourceMetadata('cycle-source'), committed);
});

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createOpfsDirectory(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { files.set(path, new Blob(parts)); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
