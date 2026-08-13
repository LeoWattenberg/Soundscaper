/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	getMemoryDatabase,
	type EditorMemoryDatabase,
} from '../src/common/editor/storage/memory-backend.ts';
import {
	ProjectRepository,
	type ProjectDocument,
} from '../src/common/editor/storage/project-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PENDING_UNTIL = '2026-08-03T12:00:00.000Z';
const PROJECT_ID = 'create-if-absent-project';
const STORAGE_KEY = 'create-if-absent-storage';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} create-if-absent leaves pre-existing staged source records pending`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		fixture.seedPendingRecords();
		const project = sourceProject();

		assert.deepEqual(await fixture.repository.createIfAbsent(project), project);
		assert.deepEqual(await fixture.repository.load(PROJECT_ID), project);
		assert.deepEqual(
			(await fixture.repository.listRevisions(PROJECT_ID)).map(({ revision }) => revision),
			[0],
		);
		assert.equal(fixture.sourceRecord()?.pendingProjectUntil, PENDING_UNTIL);
		assert.equal(fixture.mediaRecord()?.pendingProjectUntil, PENDING_UNTIL);
	});

	test(`${backend} Scape create-if-absent atomically publishes referenced staged records`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		fixture.seedPendingRecords();

		assert.deepEqual(await fixture.repository.createForScapeImportIfAbsent(sourceProject()), sourceProject());
		assert.deepEqual(await fixture.repository.load(PROJECT_ID), sourceProject());
		assert.equal(fixture.sourceRecord()?.pendingProjectUntil, undefined);
		assert.equal(fixture.mediaRecord()?.pendingProjectUntil, undefined);
	});

	test(`${backend} create-if-absent preserves an occupied current project`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		const existing = sourceFreeProject(PROJECT_ID, 4, 'Existing project');
		await fixture.repository.save(existing);
		fixture.seedPendingRecords();

		assert.equal(await fixture.repository.createIfAbsent(sourceProject()), null);
		assert.deepEqual(await fixture.repository.load(PROJECT_ID), existing);
		assert.deepEqual(
			(await fixture.repository.listRevisions(PROJECT_ID)).map(({ revision }) => revision),
			[4],
		);
		assert.equal(fixture.sourceRecord()?.pendingProjectUntil, PENDING_UNTIL);
		assert.equal(fixture.mediaRecord()?.pendingProjectUntil, PENDING_UNTIL);
	});

	test(`${backend} create-if-absent rejects an orphan revision identity`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		fixture.seedOrphanRevision();
		fixture.seedPendingRecords();

		assert.equal(await fixture.repository.createIfAbsent(sourceProject()), null);
		assert.equal(await fixture.repository.load(PROJECT_ID), null);
		assert.deepEqual(
			(await fixture.repository.listRevisions(PROJECT_ID)).map(({ revision }) => revision),
			[7],
		);
		assert.equal(fixture.sourceRecord()?.pendingProjectUntil, PENDING_UNTIL);
		assert.equal(fixture.mediaRecord()?.pendingProjectUntil, PENDING_UNTIL);
	});

	test(`${backend} create-if-absent rejects an occupied exact revision key`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		fixture.seedMalformedExactRevision();

		assert.equal(await fixture.repository.createIfAbsent(sourceProject()), null);
		assert.equal(await fixture.repository.load(PROJECT_ID), null);
		assert.equal((await fixture.repository.listRevisions(PROJECT_ID)).length, 0);
	});

	test(`${backend} delete-if-current removes only the exact project creation`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		const created = await fixture.repository.createIfAbsent(sourceProject());
		assert.ok(created);
		fixture.seedProjectBinding();

		assert.equal(await fixture.repository.deleteIfCurrent(created), true);
		assert.equal(await fixture.repository.load(PROJECT_ID), null);
		assert.deepEqual(await fixture.repository.listRevisions(PROJECT_ID), []);
		assert.equal(fixture.projectBindingCount(), 1);
		assert.equal(await fixture.repository.deleteIfCurrent(created), false);
	});

	test(`${backend} delete-if-current preserves a complete-snapshot replacement`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		const created = await fixture.repository.createIfAbsent(sourceFreeProject(
			PROJECT_ID,
			0,
			'Original title',
		));
		assert.ok(created);
		const replacement = sourceFreeProject(PROJECT_ID, 0, 'Replacement at the same revision');
		await fixture.repository.save(replacement);
		fixture.seedProjectBinding();

		assert.equal(await fixture.repository.deleteIfCurrent(created), false);
		assert.deepEqual(await fixture.repository.load(PROJECT_ID), replacement);
		assert.deepEqual(
			(await fixture.repository.listRevisions(PROJECT_ID)).map(({ project }) => project),
			[replacement],
		);
		assert.equal(fixture.projectBindingCount(), 1);
	});

	test(`${backend} delete-if-current preserves an identical later publication`, async (context) => {
		const fixture = await repositoryFixture(context, backend);
		const created = await fixture.repository.createIfAbsent(sourceFreeProject(
			PROJECT_ID,
			0,
			'Identical content',
		));
		assert.ok(created);
		await fixture.repository.save(structuredClone(created));
		fixture.seedProjectBinding();

		assert.equal(await fixture.repository.deleteIfCurrent(created), false);
		assert.deepEqual(await fixture.repository.load(PROJECT_ID), created);
		assert.equal(fixture.projectBindingCount(), 1);
	});
}

test('memory concurrent create-if-absent attempts publish exactly one destination', async (context) => {
	const fixture = await repositoryFixture(context, 'memory');
	const attempts = [
		sourceFreeProject(PROJECT_ID, 0, 'First contender'),
		sourceFreeProject(PROJECT_ID, 0, 'Second contender'),
	];

	const outcomes = await Promise.all(attempts.map((project) => (
		fixture.repository.createIfAbsent(project)
	)));
	const created = outcomes.filter((project): project is ProjectDocument => project !== null);
	assert.equal(created.length, 1);
	assert.deepEqual(await fixture.repository.load(PROJECT_ID), created[0]);
	assert.deepEqual(
		(await fixture.repository.listRevisions(PROJECT_ID)).map(({ project }) => project),
		created,
	);
});

test('IndexedDB create-if-absent rolls the project back when its revision write fails', async (context) => {
	const fixture = await repositoryFixture(context, 'indexeddb');
	fixture.seedPendingRecords();
	const failure = new Error('planned create-if-absent revision publication failure');
	fixture.indexedDB?.failNextPutForStore('revisions', failure);

	await assert.rejects(
		fixture.repository.createIfAbsent(sourceProject()),
		(error) => error === failure,
	);
	assert.equal(await fixture.repository.load(PROJECT_ID), null);
	assert.deepEqual(await fixture.repository.listRevisions(PROJECT_ID), []);
	assert.equal(fixture.sourceRecord()?.pendingProjectUntil, PENDING_UNTIL);
	assert.equal(fixture.mediaRecord()?.pendingProjectUntil, PENDING_UNTIL);
});

test('IndexedDB delete-if-current rolls every deletion back when project deletion fails', async (context) => {
	const fixture = await repositoryFixture(context, 'indexeddb');
	const created = await fixture.repository.createIfAbsent(sourceProject());
	assert.ok(created);
	fixture.seedProjectBinding();
	const failure = new Error('planned exact project deletion failure');
	fixture.indexedDB?.failNextDeleteForStore('projects', failure);

	await assert.rejects(
		fixture.repository.deleteIfCurrent(created),
		(error) => error === failure,
	);
	assert.deepEqual(await fixture.repository.load(PROJECT_ID), created);
	assert.deepEqual(
		(await fixture.repository.listRevisions(PROJECT_ID)).map(({ project }) => project),
		[created],
	);
	assert.equal(fixture.projectBindingCount(), 1);
});

test('memory create-if-absent compensates an injected write failure', async () => {
	const failure = new Error('planned memory revision publication failure');
	const revisions = new FailNextSetMap<string, unknown>();
	const memory = memoryDatabase({ revisions });
	memory.sources.set(STORAGE_KEY, pendingSourceRecord());
	memory.mediaAssets.set(STORAGE_KEY, pendingMediaRecord());
	revisions.failNextSet(failure);
	const repository = new ProjectRepository({ memory, database: async () => null }, 5);

	await assert.rejects(
		repository.createIfAbsent(sourceProject()),
		(error) => error === failure,
	);
	assert.equal(memory.projects.has(PROJECT_ID), false);
	assert.equal(memory.revisions.size, 0);
	assert.equal(record(memory.sources.get(STORAGE_KEY))?.pendingProjectUntil, PENDING_UNTIL);
	assert.equal(record(memory.mediaAssets.get(STORAGE_KEY))?.pendingProjectUntil, PENDING_UNTIL);
});

interface RepositoryFixture {
	readonly repository: ProjectRepository;
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB> | null;
	seedMalformedExactRevision(): void;
	seedOrphanRevision(): void;
	seedPendingRecords(): void;
	seedProjectBinding(): void;
	sourceRecord(): Record<string, unknown> | null;
	mediaRecord(): Record<string, unknown> | null;
	projectBindingCount(): number;
}

async function repositoryFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
): Promise<RepositoryFixture> {
	const databaseName = `project-create-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const repository = new ProjectRepository({ memory, database: async () => database }, 5);
	const seed = (
		storeName: 'revisions' | 'sources' | 'mediaAssets' | 'linkedVideoOriginalBindings',
		value: Record<string, unknown>,
	): void => {
		if (indexedDB) indexedDB.seedRecord(databaseName, storeName, value);
		else memory[storeName].set(String(value.key ?? value.id ?? value.sourceId), value);
	};
	const stored = (storeName: 'sources' | 'mediaAssets'): Record<string, unknown> | null => {
		const value = indexedDB
			? indexedDB.records(databaseName, storeName)[0]
			: memory[storeName].get(STORAGE_KEY);
		return record(value);
	};
	return {
		repository,
		indexedDB,
		seedMalformedExactRevision() {
			seed('revisions', {
				key: `${PROJECT_ID}:000000000000`,
				malformed: true,
			});
		},
		seedOrphanRevision() {
			seed('revisions', {
				key: `${PROJECT_ID}:orphan`,
				projectId: PROJECT_ID,
				revision: 7,
				project: sourceFreeProject(PROJECT_ID, 7, 'Orphan revision'),
			});
		},
		seedPendingRecords() {
			seed('sources', pendingSourceRecord());
			seed('mediaAssets', pendingMediaRecord());
		},
		seedProjectBinding() {
			seed('linkedVideoOriginalBindings', {
				key: '["create-if-absent-project","video-source"]',
				projectId: PROJECT_ID,
				binding: Object.freeze({ fixture: true }),
			});
		},
		sourceRecord: () => stored('sources'),
		mediaRecord: () => stored('mediaAssets'),
		projectBindingCount: () => indexedDB
			? indexedDB.recordCount(databaseName, 'linkedVideoOriginalBindings')
			: memory.linkedVideoOriginalBindings.size,
	};
}

function sourceProject(): ProjectDocument {
	return {
		id: PROJECT_ID,
		title: 'Created project',
		revision: 0,
		sources: [{ id: 'source-1', storageKey: STORAGE_KEY }],
		clips: [{ id: 'clip-1', sourceId: 'source-1' }],
	};
}

function sourceFreeProject(id: string, revision: number, title: string): ProjectDocument {
	return { id, revision, title, sources: [], clips: [] };
}

function pendingSourceRecord(): Record<string, unknown> {
	return { id: STORAGE_KEY, pendingProjectUntil: PENDING_UNTIL, storage: 'indexeddb-chunks' };
}

function pendingMediaRecord(): Record<string, unknown> {
	return { sourceId: STORAGE_KEY, pendingProjectUntil: PENDING_UNTIL, storage: 'indexeddb-blob' };
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function memoryDatabase(
	overrides: Partial<EditorMemoryDatabase> = {},
): EditorMemoryDatabase {
	return {
		projects: new Map(),
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
		...overrides,
	};
}

class FailNextSetMap<Key, Value> extends Map<Key, Value> {
	#failure: unknown = null;

	failNextSet(error: unknown): void {
		this.#failure = error;
	}

	override set(key: Key, value: Value): this {
		if (this.#failure !== null) {
			const failure = this.#failure;
			this.#failure = null;
			throw failure;
		}
		return super.set(key, value);
	}
}
