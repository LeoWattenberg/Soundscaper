/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	createTakeCycleRecoveryEnvelope,
	transitionTakeCycleRecoveryEnvelopeMedia,
} from '../src/common/editor/take-cycle-recovery-envelope.ts';
import { TakeCycleRecoveryEnvelopeRepository } from '../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} envelope repository reloads and CAS-transitions one exact lane`, async () => {
		const databaseName = uniqueName();
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const store = createProjectStore({ indexedDB, preferOpfs: false, databaseName });
		const repository = new TakeCycleRecoveryEnvelopeRepository(store.analysisRepository);
		const staged = envelope();
		await repository.create(staged);

		const restartedStore = createProjectStore({ indexedDB, preferOpfs: false, databaseName });
		const restarted = new TakeCycleRecoveryEnvelopeRepository(restartedStore.analysisRepository);
		const loaded = await restarted.load('project-cycle');
		assert.deepEqual(loaded, staged);
		assert.notEqual(loaded, staged);

		const published = transitionTakeCycleRecoveryEnvelopeMedia(loaded!, {
			entryIndex: 0,
			currentGeneration: 7,
			evidence: loaded!.entries[0]!.journal.binding,
		});
		await restarted.replace(loaded!, published);
		assert.deepEqual(await repository.load('project-cycle'), published);
		await restarted.remove(published);
		assert.equal(await repository.load('project-cycle'), null);
	});
}

test('the durable envelope repository refuses competing create and stale transition ownership', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: uniqueName() });
	const repository = new TakeCycleRecoveryEnvelopeRepository(store.analysisRepository);
	const staged = envelope();
	await repository.create(staged);
	await assert.rejects(repository.create(staged), /already has an active recovery envelope/u);

	const published = transitionTakeCycleRecoveryEnvelopeMedia(staged, {
		entryIndex: 0,
		currentGeneration: 7,
		evidence: staged.entries[0]!.journal.binding,
	});
	await repository.replace(staged, published);
	await assert.rejects(
		repository.replace(staged, published),
		/recovery envelope changed before replacement/u,
	);
	await assert.rejects(
		repository.remove(staged),
		/recovery envelope changed before removal/u,
	);
	assert.deepEqual(await repository.load('project-cycle'), published);
});

function envelope() {
	const targetProjectDocument = serializeScapeProjectDocument({
		id: 'project-cycle', revision: 2, takeIds: ['take-a'],
	});
	return createTakeCycleRecoveryEnvelope({
		envelopeId: 'envelope-cycle',
		generation: 7,
		captureRequest: {
			groupId: 'group-cycle', laneId: 'lane-cycle',
			loopStartSample: 0, loopEndSample: 100,
			captureSpans: [{ startSample: 0, endSample: 100 }],
			takeIds: ['take-a'], interrupted: false,
		},
		publications: [{
			journalId: 'journal-a', mediaId: 'media-a', byteLength: 100,
			sha256: 'ab'.repeat(32),
			stageReceipt: {
				version: 1, sourceId: 'media-a', sourceToken: 'media-a:pending:write-receipt-a',
			},
		}],
		projectFence: {
			projectId: 'project-cycle', baseRevision: 1, baseSha256: '12'.repeat(32),
			targetRevision: 2,
			targetSha256: digestScapeBytes(new TextEncoder().encode(targetProjectDocument)),
		},
		targetProjectDocument,
	});
}

function uniqueName(): string {
	return `cycle-envelope-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
