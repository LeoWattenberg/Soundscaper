/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	persistDecodedLegacyAupProject,
	type PersistDecodedLegacyAupProjectOptions,
} from '../src/common/editor/controller/import/internal/legacy-aup-project-persistence.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} legacy AUP import refuses a colliding project ID without changing the stored project`, async () => {
	const store = createProjectStore({
		indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
		preferOpfs: false,
		databaseName: `aup-create-only-${backend}-${crypto.randomUUID()}`,
	});
	const existing = createAudioEditorProjectV17({
		id: 'imported-project', title: 'Existing session', now: '2026-08-14T10:00:00.000Z',
	});
	await store.createProjectIfAbsent(existing);
	const imported = { ...existing, title: 'Colliding Audacity import' };
	let switched = false;
	await assert.rejects(() => persistDecodedLegacyAupProject({
		decoded: { project: imported, sources: [] },
		sourceChunkFrames: 1,
		copy: {
			structuredProjectRequired: 'A structured project is required.',
			importedSourceDescriptorMissing: 'A source is missing.',
			importedSourcePcmInvalid: 'Source PCM is invalid.',
		},
		generateWaveformPeaks: async () => undefined,
		getProject: () => null,
		peakCacheKey: (id) => id,
		preflightStorage: async () => undefined,
		store: store as unknown as PersistDecodedLegacyAupProjectOptions['store'],
		switchProject: async () => { switched = true; },
	}), /already exists/iu);
	assert.deepEqual(await store.loadProject(existing.id), existing);
	assert.equal(switched, false);
});
}
