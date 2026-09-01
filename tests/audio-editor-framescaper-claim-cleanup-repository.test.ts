/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from
	'../src/common/editor/storage/media-asset-staging-schema.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { FramescaperProjectSequenceClaimCleanupRepository } from
	'../src/framescaper/editor-project-sequence-claim-cleanup-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('claim cleanup propagates IndexedDB inventory read failures', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(
		indexedDB as unknown as IDBFactory,
		`claim-cleanup-read-failure-${String(Date.now())}-${String(Math.random())}`,
	);
	context.after(() => database.close());
	const failure = new DOMException('planned inventory read failure', 'UnknownError');
	indexedDB.failNextGetAllForStore('projects', failure);
	const repository = new FramescaperProjectSequenceClaimCleanupRepository(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		{
			port: { memory: {}, database: async () => database },
			opfs: { directory: async () => { throw new Error('No physical cleanup is expected.'); } },
		},
	);
	await assert.rejects(
		repository.reconcile({ sessionProjects: [], histories: [], pendingSaveSnapshots: [] }),
		(error) => error === failure,
	);
});

test('claim cleanup propagates malformed durable inventory records', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(
		indexedDB as unknown as IDBFactory,
		`claim-cleanup-malformed-${String(Date.now())}-${String(Math.random())}`,
	);
	context.after(() => database.close());
	await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.put({ key: 'malformed-claim', kind: 'video-proxy-claim' });
	});
	const repository = new FramescaperProjectSequenceClaimCleanupRepository(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		{
			port: { memory: {}, database: async () => database },
			opfs: { directory: async () => { throw new Error('No physical cleanup is expected.'); } },
		},
	);
	await assert.rejects(
		repository.reconcile({ sessionProjects: [], histories: [], pendingSaveSnapshots: [] }),
		/video proxy claim|closed record|field/iu,
	);
});
