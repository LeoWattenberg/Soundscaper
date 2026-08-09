/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createDesktopProjectLibraryPaths } from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import {
	type DesktopLibraryLoadedProject,
	DesktopLibraryProjectStore,
} from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'writer-coordinator-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'writer-coordinator-b',
});

test('observer startup waits for stale expiry only when a mutation needs the writer', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-writer-stale-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const library = await SharedDesktopProjectLibrary.open(createDesktopProjectLibraryPaths(appDataPath));
	const stale = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	library.close();

	const startedAt = Date.now();
	const observer = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: OWNER_B,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
	});
	context.after(() => observer.close());
	assert.ok(Date.now() - startedAt < 500, 'observer startup must not wait for the writer lease');
	assert.equal(observer.snapshot().activeWriter, null);
	assert.equal(observer.snapshot().lastWriter, null);
	assert.deepEqual(observer.readCatalog().projects, []);

	assert.equal(await observer.deleteProjectById({ projectId: 'missing-project' }), false);
	assert.ok(observer.snapshot().lastWriter!.fencingToken > stale.fencingToken);
	assert.equal(observer.snapshot().lastWriter!.tookOverStaleLease, true);
});

test('renewal loss aborts admitted mutation work, fences new work, and reports once', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-writer-loss-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const projectPrototype = DesktopLibraryProjectStore.prototype;
	const libraryPrototype = SharedDesktopProjectLibrary.prototype;
	const originalCommit = projectPrototype.commitProject;
	const originalRenew = libraryPrototype.renewLease;
	let confirmStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => { confirmStarted = resolve; });
	let operationSignal: AbortSignal | undefined;
	projectPrototype.commitProject = async (options) => {
		operationSignal = options.signal;
		confirmStarted?.();
		return new Promise((_resolve, reject) => {
			options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
		});
	};
	const renewalFailure = new Error('planned renewal loss');
	libraryPrototype.renewLease = async () => { throw renewalFailure; };
	context.after(() => {
		projectPrototype.commitProject = originalCommit;
		libraryPrototype.renewLease = originalRenew;
	});
	const losses: unknown[] = [];
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: OWNER_A,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
		onLeaseLost: (error) => { losses.push(error); },
	});
	context.after(() => host.close());
	const mutation = host.commitProject({
		entryId: 'writer-loss-entry',
		name: 'Writer loss',
		preferredProduct: 'soundscaper',
		project: {},
		updatedAtMs: 1,
	});
	await started;
	await assert.rejects(mutation, (error) => error === renewalFailure);
	assert.equal(operationSignal?.aborted, true);
	assert.deepEqual(losses, [renewalFailure]);
	await assert.rejects(host.readProject('writer-loss-entry'), /lost its writer lease/u);
	await assert.rejects(host.deleteProjectById({ projectId: 'missing' }), /lost its writer lease/u);
});

test('an aborted prepared publication recovers and reclaims its own lease inventory before release', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-writer-abort-cleanup-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const controller = new AbortController();
	const abortError = new Error('planned renderer loss at prepared');
	let interrupted = false;
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: OWNER_A,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
		checkpoint: (phase) => {
			if (phase !== 'prepared' || interrupted) return;
			interrupted = true;
			controller.abort(abortError);
		},
	});
	context.after(() => host.close());
	await assert.rejects(host.commitProjectById({
		createEntryId: () => 'prepared-abort-entry',
		expectedRevision: null,
		name: 'Prepared abort',
		preferredProduct: 'soundscaper',
		project: createAudioEditorProjectV10({
			id: 'prepared-abort-project', title: 'Prepared abort', revision: 1,
		}),
		signal: controller.signal,
		updatedAtMs: 1,
	}), (error) => error instanceof Error && error.name === 'AbortError' && error.cause === abortError);
	assert.deepEqual(host.readCatalog().projects, []);
	assert.equal(host.snapshot().lastWriter?.recovery.outcome, 'interrupted');

	const database = new DatabaseSync(createDesktopProjectLibraryPaths(appDataPath).databasePath);
	context.after(() => database.close());
	const pendingJournal = database.prepare(`
		SELECT count(*) AS count FROM metadata_journal WHERE state IN ('prepared', 'committed')
	`).get() as { count: number };
	assert.equal(pendingJournal.count, 0, 'metadata journal must be settled before release');
	for (const table of ['project_file_inventory', 'project_stage_inventory']) {
		const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
		assert.equal(row.count, 0, `${table} must be empty before the writer lease is released`);
	}
});

test('an aborted media publication reclaims its own canonical and stage inventory before release', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-writer-media-abort-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const controller = new AbortController();
	const abortError = new Error('planned media renderer loss at prepared');
	let interrupted = false;
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: OWNER_A,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
		checkpoint: (phase) => {
			if (phase !== 'prepared' || interrupted) return;
			interrupted = true;
			controller.abort(abortError);
		},
	});
	context.after(() => host.close());
	const projectPrototype = DesktopLibraryProjectStore.prototype;
	const originalRead = projectPrototype.readProjectById;
	projectPrototype.readProjectById = async () => ({
		catalog: { projectRevision: 2, sha256: 'a'.repeat(64) },
		project: {},
	}) as DesktopLibraryLoadedProject;
	context.after(() => { projectPrototype.readProjectById = originalRead; });
	const body = Uint8Array.of(1, 2, 3, 4);
	await assert.rejects(host.publishManagedAudio({
		projectId: 'media-abort-project',
		storageKey: 'media-abort-source',
		byteLength: body.byteLength,
		sha256: createHash('sha256').update(body).digest('hex'),
		expectedProjectRevision: 2,
		expectedProjectSha256: 'a'.repeat(64),
		chunks: (async function* () { yield body; })(),
		signal: controller.signal,
	}), (error) => error instanceof Error && error.name === 'AbortError' && error.cause === abortError);
	assert.deepEqual(host.readCatalog().media, []);
	assert.equal(host.snapshot().lastWriter?.recovery.outcome, 'interrupted');

	const database = new DatabaseSync(createDesktopProjectLibraryPaths(appDataPath).databasePath);
	context.after(() => database.close());
	const pendingJournal = database.prepare(`
		SELECT count(*) AS count FROM metadata_journal WHERE state IN ('prepared', 'committed')
	`).get() as { count: number };
	assert.equal(pendingJournal.count, 0, 'metadata journal must be settled before release');
	for (const table of ['managed_media_inventory', 'managed_media_stage_inventory']) {
		const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
		assert.equal(row.count, 0, `${table} must be empty when the mutation settles`);
	}
});
