/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV9 } from '../src/common/editor/project-v9.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { DesktopSharedProjectRepository } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { DesktopSharedProjectSourceAvailability } from '../src/common/editor/storage/desktop-shared-project-source-availability.ts';
import { ProjectRepository, type ProjectDocument } from '../src/common/editor/storage/project-repository.ts';

const NOW = '2026-07-30T12:00:00.000Z';

test('a slow latest load cannot overwrite a concurrent shared save', async () => {
	const local = memoryRepository('load-save');
	const prior = project('serialized-save', 0);
	const loaded = project(prior.id, 1);
	const saved = project(prior.id, 2);
	await local.save(prior);
	const readStarted = deferred<void>();
	const releaseRead = deferred<void>();
	let commits = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			async readSharedProject() {
				readStarted.resolve();
				await releaseRead.promise;
				return serializeScapeProjectDocument(loaded);
			},
			async commitSharedProject(document) {
				commits += 1;
				return document;
			},
			deleteSharedProject: async () => true,
		},
	});

	const loading = repository.load(prior.id);
	await readStarted.promise;
	const saving = repository.save(saved);
	await eventLoopTurn();
	assert.equal((await local.load(prior.id))?.revision, 0);
	assert.equal(commits, 0);
	releaseRead.resolve();
	await Promise.all([loading, saving]);

	assert.equal((await local.load(prior.id))?.revision, 2);
	assert.equal(commits, 1);
});

test('a slow latest load cannot resurrect a concurrently deleted shared project', async () => {
	const local = memoryRepository('load-delete');
	const prior = project('serialized-delete', 0);
	const loaded = project(prior.id, 1);
	await local.save(prior);
	const readStarted = deferred<void>();
	const releaseRead = deferred<void>();
	let remoteDeletes = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			async readSharedProject() {
				readStarted.resolve();
				await releaseRead.promise;
				return serializeScapeProjectDocument(loaded);
			},
			commitSharedProject: async (document) => document,
			async deleteSharedProject() {
				remoteDeletes += 1;
				return true;
			},
		},
	});

	const loading = repository.load(prior.id);
	await readStarted.promise;
	const deleting = repository.delete(prior.id);
	await eventLoopTurn();
	assert.equal(remoteDeletes, 0);
	assert.equal((await local.load(prior.id))?.revision, 0);
	releaseRead.resolve();
	await Promise.all([loading, deleting]);

	assert.equal(remoteDeletes, 1);
	assert.equal(await local.load(prior.id), null);
});

test('shared save maintenance runs after acknowledgement and before the next latest load', async () => {
	const local = memoryRepository('save-maintenance');
	const saved = project('serialized-maintenance', 2);
	const document = serializeScapeProjectDocument(saved);
	const maintenanceStarted = deferred<void>();
	const releaseMaintenance = deferred<void>();
	const events: string[] = [];
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => { events.push('read'); return document; },
			commitSharedProject: async (value) => { events.push('commit'); return value; },
			deleteSharedProject: async () => true,
		},
	});

	const saving = repository.save(saved, async () => {
		events.push('maintenance');
		maintenanceStarted.resolve();
		await releaseMaintenance.promise;
	});
	await maintenanceStarted.promise;
	const loading = repository.load(saved.id);
	await eventLoopTurn();
	assert.deepEqual(events, ['commit', 'maintenance']);
	releaseMaintenance.resolve();
	await Promise.all([saving, loading]);
	assert.deepEqual(events, ['commit', 'maintenance', 'read']);
});

test('failed shared publication never invokes post-commit maintenance', async () => {
	const local = memoryRepository('save-maintenance-failure');
	const saved = project('rejected-maintenance', 1);
	const failure = new Error('planned remote publication failure');
	let maintenanceCalls = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => null,
			commitSharedProject: async () => { throw failure; },
			deleteSharedProject: async () => true,
		},
	});

	await assert.rejects(repository.save(saved, async () => {
		maintenanceCalls += 1;
	}), (error) => error === failure);
	assert.equal(maintenanceCalls, 0);
});

test('local save maintenance observes the compacted retained revision set', async () => {
	const local = new ProjectRepository({
		memory: getMemoryDatabase(`local-maintenance-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, 2);
	const id = 'local-maintenance';
	await local.save(project(id, 0));
	await local.save(project(id, 1));
	let retained: number[] = [];

	await local.save(project(id, 2), async () => {
		retained = (await local.listRevisions(id)).map(({ revision }) => revision);
	});
	assert.deepEqual(retained, [2, 1]);
});

function project(id: string, revision: number): ProjectDocument {
	return createAudioEditorProjectV9({ id, title: `Revision ${revision}`, revision, now: NOW });
}

function memoryRepository(scope: string): ProjectRepository {
	return new ProjectRepository({
		memory: getMemoryDatabase(`${scope}-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, 5);
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

async function eventLoopTurn(): Promise<void> {
	await new Promise<void>((resolve) => { setImmediate(resolve); });
}

function throwingSourceAvailability(): DesktopSharedProjectSourceAvailability {
	const unexpected = (): never => { throw new Error('Source-free serialization touched media.'); };
	return {
		getSourceMetadata: async () => unexpected(),
		readSourceChunks: () => unexpected(),
		getMediaAssetMetadata: async () => unexpected(),
		loadMediaAsset: async () => unexpected(),
	};
}
