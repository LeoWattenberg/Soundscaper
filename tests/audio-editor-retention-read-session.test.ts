/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import type { SourcePcmReadSession } from '../src/common/editor/storage/source-read-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	for (const orphan of [false, true]) {
		test(`${backend} pruning preserves retained PCM reads${orphan ? ' while closing deleted-source reads' : ' when nothing is deleted'}`, async () => {
			const store = createProjectStore({
				indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() as unknown as IDBFactory : null,
				memoryFallback: false,
				preferOpfs: false,
				databaseName: `retention-read-session-${backend}-${orphan}-${Math.random()}`,
			});
			try {
				const sessions = new Map<string, SourcePcmReadSession>();
				for (const id of orphan ? ['retained', 'orphan'] : ['retained']) {
					const writer = await store.beginSourceWrite(id, { sampleRate: 48_000, channelCount: 1, chunkFrames: 1 });
					await writer.write([Float32Array.of(0.25)]);
					await writer.commit({ chunkFrames: 1 });
					const session = await store.openSourceReadSession(id);
					assert.ok(session);
					sessions.set(id, session);
				}
				const result = await store.pruneUnreferencedSources({ protectedSourceIds: ['retained'], minimumAgeMs: 0, now: Date.now() + 2 * 86_400_000 });
				assert.deepEqual(result.deletedSourceIds, orphan ? ['orphan'] : []);
				const retained = sessions.get('retained');
				assert.ok(retained);
				assert.deepEqual((await retained.chunk(0)).channels[0], Float32Array.of(0.25));
				if (orphan) {
					const removed = sessions.get('orphan');
					assert.ok(removed);
					await assert.rejects(removed.chunk(0), /released/u);
				}
			} finally {
				await store.close();
			}
		});
	}
}
