/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { SourceWriteRepository } from '../src/common/editor/storage/source-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`clear invalidates an open ${backend} PCM writer before deleting its staged chunks`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: `source-write-clear-${backend}-${Date.now()}-${Math.random()}`,
		});
		const writer = await store.beginSourceWrite('pending-source', {
			sampleRate: 48_000,
			channelCount: 1,
		});
		await writer.write([Float32Array.of(0.25, -0.5)]);

		await store.clear();

		await assert.rejects(writer.commit(), { name: 'AbortError' });
		assert.equal(await store.getSourceMetadata('pending-source'), null);
		assert.deepEqual(await store.listSources(), []);
		await writer.abort();
		await store.close();
	});
}

test('memory clear waits for a successful derived publication before removing it', async () => {
	const published = deferred();
	const releasePublication = deferred();
	const originalWriteDerived = SourceWriteRepository.prototype.writeDerived;
	SourceWriteRepository.prototype.writeDerived = async function (...args) {
		const record = await originalWriteDerived.apply(this, args);
		if (args[0] === 'derived-source') {
			published.resolve();
			await releasePublication.promise;
		}
		return record;
	};
	const store = createProjectStore({
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		databaseName: `derived-source-clear-memory-${Date.now()}-${Math.random()}`,
	});
	const sourceRecords = store.memory.sources;
	const clearSources = sourceRecords.clear.bind(sourceRecords);
	let publicationReleased = false;
	sourceRecords.clear = () => {
		assert.equal(publicationReleased, true, 'clear reached source deletion before derived publication settled');
		clearSources();
	};
	try {
		const baseWriter = await store.beginSourceWrite('base-source', {
			sampleRate: 48_000,
			channelCount: 1,
			chunkFrames: 2,
		});
		await baseWriter.write([Float32Array.of(0.25, -0.5)]);
		await baseWriter.commit();
		const publishing = store.sourceRepository.writeDerived('derived-source', 'base-source', [{
			index: 0,
			channels: [Float32Array.of(0.5, -0.25)],
		}]);
		await published.promise;

		const clearing = store.clear();
		void clearing.catch(() => undefined);
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		publicationReleased = true;
		releasePublication.resolve();

		assert.equal((await publishing).id, 'derived-source');
		await clearing;
		assert.equal(await store.getSourceMetadata('derived-source'), null);
		assert.deepEqual(await store.listSources(), []);
	} finally {
		publicationReleased = true;
		releasePublication.resolve();
		SourceWriteRepository.prototype.writeDerived = originalWriteDerived;
		sourceRecords.clear = clearSources;
		await store.close();
	}
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}
