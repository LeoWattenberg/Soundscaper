/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES,
	ProjectPublicationQuotaError,
	estimateProjectRevisionPublication,
	projectRevisionPublicationCapacityRequirement,
} from '../src/common/editor/project-publication-admission.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('the project store rejects an oversized snapshot before current or revision mutation', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-limit'),
		maximumProjectDocumentBytes: 160,
	});
	const retained = {
		schemaVersion: 9,
		id: 'bounded-store-project',
		title: 'Retained',
		revision: 1,
		updatedAt: '2026-08-01T00:00:00.000Z',
	};
	await store.saveProject(retained);

	await assert.rejects(
		store.saveProject({
			...retained,
			title: 'x'.repeat(256),
			revision: 2,
		}),
		/exceeds its byte limit/u,
	);

	assert.deepEqual(await store.loadProject(retained.id), retained);
	assert.deepEqual(
		(await store.listProjectRevisions(retained.id)).map((entry) => entry.revision),
		[1],
	);
});

test('the project store document-limit seam cannot raise the production ceiling', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-invalid-limit'),
		maximumProjectDocumentBytes: MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES + 1,
	});

	await assert.rejects(
		store.saveProject({ id: 'must-not-publish', revision: 1 }),
		/document byte limit is invalid/u,
	);
	assert.deepEqual(await store.listProjects(), []);
});

test('known IndexedDB shortage rejects before project mutation and a boundary retry recovers', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	let estimate = { usage: 0, quota: Number.MAX_SAFE_INTEGER };
	let estimateCalls = 0;
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-capacity'),
		storageManager: {
			estimate: async () => {
				estimateCalls += 1;
				return estimate;
			},
		},
	});
	context.after(async () => { await store.close(); });
	const retained = {
		schemaVersion: 9,
		id: 'capacity-project',
		title: 'Retained',
		revision: 1,
		updatedAt: '2026-08-01T00:00:00.000Z',
	};
	await store.saveProject(retained);
	const replacement = {
		...retained,
		title: 'Grüße 🎛️',
		revision: 2,
		opaqueExtensions: { bytes: Uint8Array.of(0, 1, 254, 255) },
	};
	const publicationBytes = estimateProjectRevisionPublication(replacement).currentAndRevision.bytes;
	const requirement = projectRevisionPublicationCapacityRequirement(publicationBytes);
	estimate = { usage: 100, quota: 100 + requirement.requiredFreeBytes - 1 };

	await assert.rejects(
		store.saveProject(replacement),
		(error: unknown) => error instanceof ProjectPublicationQuotaError,
	);
	assert.deepEqual(await store.loadProject(retained.id), retained);
	assert.deepEqual(
		(await store.listProjectRevisions(retained.id)).map(({ revision }) => revision),
		[1],
	);

	estimate = { usage: 100, quota: 100 + requirement.requiredFreeBytes };
	assert.deepEqual(await store.saveProject(replacement), replacement);
	assert.equal((await store.loadProject(retained.id))?.revision, 2);
	assert.equal(estimateCalls, 3);
});

test('an in-flight IndexedDB quota rejection rolls the publication back to the retained revision', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-publication-quota-write'),
	});
	context.after(async () => { await store.close(); });
	const retained = {
		schemaVersion: 9,
		id: 'quota-write-project',
		title: 'Retained',
		revision: 1,
		updatedAt: '2026-08-01T00:00:00.000Z',
	};
	await store.saveProject(retained);
	const replacement = { ...retained, title: 'Replacement', revision: 2 };
	const exhaustion = new DOMException('The storage quota was exceeded during a write.', 'QuotaExceededError');
	indexedDB.failNextPutForStore('projects', exhaustion);

	await assert.rejects(
		store.saveProject(replacement),
		/IndexedDB transaction/u,
	);
	assert.deepEqual(await store.loadProject(retained.id), retained);
	assert.deepEqual(
		(await store.listProjectRevisions(retained.id)).map(({ revision }) => revision),
		[1],
	);

	assert.deepEqual(await store.saveProject(replacement), replacement);
	assert.equal((await store.loadProject(retained.id))?.revision, 2);
});

test('memory and IndexedDB fallback saves do not consult durable capacity', async (context) => {
	let estimateCalls = 0;
	const storageManager = {
		estimate: async () => {
			estimateCalls += 1;
			return { usage: 1, quota: 1 };
		},
	};
	const memory = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-capacity-memory'),
		storageManager,
	});
	const fallback = createProjectStore({
		indexedDB: { open() { throw new DOMException('restricted', 'SecurityError'); } } as unknown as IDBFactory,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-capacity-fallback'),
		storageManager,
	});
	context.after(async () => { await Promise.all([memory.close(), fallback.close()]); });

	await memory.saveProject({ id: 'memory-project', revision: 1 });
	await fallback.saveProject({ id: 'fallback-project', revision: 1 });
	assert.equal(fallback.getStatus().backend, 'memory');
	assert.equal(estimateCalls, 0);
});

test('unknown IndexedDB capacity proceeds while a throwing estimate remains advisory', async (context) => {
	let estimateCalls = 0;
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-capacity-unknown'),
		storageManager: {
			estimate: async () => {
				estimateCalls += 1;
				throw new Error('estimate unavailable');
			},
		},
	});
	context.after(async () => { await store.close(); });

	await store.saveProject({ id: 'unknown-capacity-project', revision: 1 });
	assert.equal(estimateCalls, 1);
	assert.equal((await store.loadProject('unknown-capacity-project'))?.revision, 1);
});

test('a caller capacity admission receives exact canonical bytes without a second estimate', async (context) => {
	let estimateCalls = 0;
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-capacity-caller'),
		storageManager: {
			estimate: async () => {
				estimateCalls += 1;
				return { usage: 1, quota: 1 };
			},
		},
	});
	context.after(async () => { await store.close(); });
	const project = {
		schemaVersion: 9,
		id: 'caller-admission-project',
		revision: 1,
		title: 'Grüße 🎛️',
		opaqueExtensions: { bytes: Uint8Array.of(1, 2, 3) },
	};
	const expectedBytes = estimateProjectRevisionPublication(project).currentAndRevision.bytes;
	const refusal = new Error('caller capacity refused');
	let admittedBytes: number | null = null;

	await assert.rejects(store.saveProject(project, {
		admitProjectPublication(bytes: number) {
			admittedBytes = bytes;
			throw refusal;
		},
	}), (error: unknown) => error === refusal);
	assert.equal(admittedBytes, expectedBytes);
	assert.deepEqual(await store.listProjects(), []);

	assert.deepEqual(await store.saveProject(project, {
		admitProjectPublication(bytes: number) {
			assert.equal(bytes, expectedBytes);
		},
	}), project);
	assert.equal(estimateCalls, 0);
});

test('desktop shared publication does not start after central capacity refusal', async (context) => {
	let commits = 0;
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('project-capacity-desktop-shared'),
		storageManager: { estimate: async () => ({ usage: 1, quota: 1 }) },
		desktopProjectBridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => null,
			commitSharedProject: async (document: string) => {
				commits += 1;
				return document;
			},
			deleteSharedProject: async () => true,
		},
	});
	context.after(async () => { await store.close(); });

	await assert.rejects(
		store.saveProject({ id: 'capacity-shared-project', revision: 1 }),
		(error: unknown) => error instanceof ProjectPublicationQuotaError,
	);
	assert.equal(commits, 0);
	assert.deepEqual(await store.listProjectRevisions('capacity-shared-project'), []);
});

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${String(Date.now())}-${String(Math.random())}`;
}
