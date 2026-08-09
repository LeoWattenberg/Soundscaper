/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryProjectMetadataFile,
	createDesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import { createDesktopLibraryProjectStageFile } from '../desktop/project-library-stage-inventory.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'project-store-soundscaper',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'project-store-framescaper',
});
const ENTRY_ID = 'library-entry-1';

test('project commits publish a verified immutable document before its catalog entry', async (context) => {
	const fixture = await createFixture(context);
	const writer = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const observer = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		writer.close();
		observer.close();
	});
	const projects = new DesktopLibraryProjectStore(writer);
	const observedProjects = new DesktopLibraryProjectStore(observer);
	const lease = await writer.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = currentProject(1);
	const documentJson = serializeScapeProjectDocument(project);
	const sha256 = createHash('sha256').update(documentJson, 'utf8').digest('hex');

	const committed = await projects.commitProject({
		lease,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project,
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_001,
	});

	assert.deepEqual(committed.catalog, {
		id: ENTRY_ID,
		projectId: 'project / identity',
		name: 'Shared project',
		metadataFile: createDesktopLibraryProjectMetadataFile(ENTRY_ID, 1, sha256),
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_001,
		projectSchemaVersion: 12,
		projectRevision: 1,
		byteLength: Buffer.byteLength(documentJson, 'utf8'),
		sha256,
	});
	assert.deepEqual(committed.project, project);
	assert.deepEqual(observer.readMetadata(), {
		schemaVersion: 4,
		revision: 1,
		projects: [committed.catalog],
		media: [],
	});
	assert.deepEqual(await observedProjects.readProject(ENTRY_ID), committed);
	assert.equal(
		await readFile(join(fixture.paths.projectsRoot, committed.catalog.metadataFile), 'utf8'),
		documentJson,
	);
	assert.equal((await stat(join(fixture.paths.projectsRoot, committed.catalog.metadataFile))).mode & 0o777, 0o600);
});

test('project persistence admission is current-schema, bounded, and mutation-free on rejection', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library, { maximumDocumentBytes: 2_048 });
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const valid = currentProject(1);
	const attempts: readonly unknown[] = [
		{ ...valid, schemaVersion: 8 },
		{ ...valid, schemaVersion: 13 },
		{ ...valid, id: '' },
		{ ...valid, revision: -1 },
		{ ...valid, title: 'x'.repeat(4_096) },
		Object.defineProperty({ ...valid }, 'schemaVersion', { get: () => 9, enumerable: true }),
	];
	for (const project of attempts) {
		await assert.rejects(
			() => projects.commitProject({
				lease,
				entryId: ENTRY_ID,
				name: 'Shared project',
				project,
				preferredProduct: 'soundscaper',
				updatedAtMs: 10_001,
			}),
			/schema|non-empty|revision|byte limit|accessor/u,
		);
		assert.equal(library.readMetadata().revision, 0);
	}
	await assert.rejects(() => stat(join(fixture.paths.projectsRoot, ENTRY_ID)), /ENOENT/u);
});

test('project commits reject a symlinked entry directory', {
	skip: process.platform === 'win32',
}, async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const redirected = join(fixture.paths.libraryRoot, 'redirected-project');
	await mkdir(redirected, { mode: 0o700 });
	await symlink(redirected, join(fixture.paths.projectsRoot, ENTRY_ID), 'dir');

	await assert.rejects(
		() => projects.commitProject({
			lease,
			entryId: ENTRY_ID,
			name: 'Shared project',
			project: currentProject(1),
			preferredProduct: 'soundscaper',
			updatedAtMs: 10_001,
		}),
		/project scope is not a directory/u,
	);
	assert.deepEqual(await readdir(redirected), []);
	assert.equal(library.readMetadata().revision, 0);
});

test('a pre-existing stage collision is preserved when exclusive creation fails', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const stageId = 'f'.repeat(32);
	const projects = new DesktopLibraryProjectStore(library, { randomId: () => stageId });
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = currentProject(1);
	const documentJson = serializeScapeProjectDocument(project);
	const sha256 = createHash('sha256').update(documentJson, 'utf8').digest('hex');
	const metadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 1, sha256);
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, stageId);
	const stagePath = join(fixture.paths.projectsRoot, ...stageFile.split('/'));
	await mkdir(join(fixture.paths.projectsRoot, ENTRY_ID), { recursive: true });
	await writeFile(stagePath, 'foreign stage bytes');

	await assert.rejects(
		() => projects.commitProject({
			lease,
			entryId: ENTRY_ID,
			name: 'Shared project',
			project,
			preferredProduct: 'soundscaper',
			updatedAtMs: 10_001,
		}),
		(error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST',
	);
	assert.equal(await readFile(stagePath, 'utf8'), 'foreign stage bytes');
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

test('catalog publication preserves other entries and media and rejects divergent project revisions', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	await library.publishMetadata({
		lease,
		metadata: {
			schemaVersion: 4,
			revision: 1,
			projects: [],
			media: [{
				id: 'managed-media-1',
				relativeFile: 'ab/managed-media-1.wav',
				byteLength: 48_000,
				sha256: 'a'.repeat(64),
			}],
		},
	});
	const first = await projects.commitProject({
		lease,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project: currentProject(1),
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_001,
	});
	await assert.rejects(
		() => projects.commitProject({
			lease,
			entryId: ENTRY_ID,
			name: 'Diverged project',
			project: { ...currentProject(1), title: 'Diverged project' },
			preferredProduct: 'framescaper',
			updatedAtMs: 10_002,
		}),
		/divergent project revision/u,
	);
	assert.deepEqual(library.readMetadata(), {
		schemaVersion: 4,
		revision: 2,
		projects: [first.catalog],
		media: [{
			id: 'managed-media-1',
			relativeFile: 'ab/managed-media-1.wav',
			byteLength: 48_000,
			sha256: 'a'.repeat(64),
		}],
	});
});

test('catalog readers observe an old or new complete project pair during publication', async (context) => {
	const fixture = await createFixture(context);
	let preparedCount = 0;
	let confirmPrepared: (() => void) | undefined;
	let continuePublication: (() => void) | undefined;
	const prepared = new Promise<void>((resolvePromise) => { confirmPrepared = resolvePromise; });
	const publicationAllowed = new Promise<void>((resolvePromise) => { continuePublication = resolvePromise; });
	const writer = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: async (phase) => {
			if (phase !== 'prepared' || ++preparedCount !== 2) return;
			confirmPrepared?.();
			await publicationAllowed;
		},
	});
	const observer = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		writer.close();
		observer.close();
	});
	const projects = new DesktopLibraryProjectStore(writer);
	const observedProjects = new DesktopLibraryProjectStore(observer);
	const lease = await writer.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const first = await projects.commitProject({
		lease,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project: currentProject(1),
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_001,
	});
	const publication = projects.commitProject({
		lease,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project: currentProject(2),
		preferredProduct: 'framescaper',
		updatedAtMs: 10_002,
	});
	await prepared;
	assert.deepEqual(await observedProjects.readProject(ENTRY_ID), first);
	continuePublication?.();
	const second = await publication;
	assert.deepEqual(await observedProjects.readProject(ENTRY_ID), second);
	assert.notEqual(first.catalog.metadataFile, second.catalog.metadataFile);
});

test('stale project writers and corrupted immutable files fail closed', async (context) => {
	const fixture = await createFixture(context);
	const firstLibrary = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const secondLibrary = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		firstLibrary.close();
		secondLibrary.close();
	});
	const firstProjects = new DesktopLibraryProjectStore(firstLibrary);
	const secondProjects = new DesktopLibraryProjectStore(secondLibrary);
	const original = await firstLibrary.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const committed = await firstProjects.commitProject({
		lease: original,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project: currentProject(1),
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_001,
	});
	fixture.clock.value = original.expiresAtMs + 1;
	await secondLibrary.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	await assert.rejects(
		() => firstProjects.commitProject({
			lease: original,
			entryId: ENTRY_ID,
			name: 'Shared project',
			project: currentProject(2),
			preferredProduct: 'soundscaper',
			updatedAtMs: 11_002,
		}),
		/no longer owns the lease/u,
	);
	assert.deepEqual(await secondProjects.readProject(ENTRY_ID), committed);

	await writeFile(join(fixture.paths.projectsRoot, committed.catalog.metadataFile), '{"schemaVersion":9}');
	await assert.rejects(
		() => secondProjects.readProject(ENTRY_ID),
		/byte length|digest/u,
	);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-projects-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

function currentProject(revision: number) {
	const project = createCurrentAudioEditorProject({
		id: 'project / identity',
		title: 'Shared project',
		revision,
		now: '2026-07-29T10:00:00.000Z',
	});
	return {
		...project,
		desktopState: new Uint8Array([1, 3, 5, revision]),
	};
}

function stageInventoryRows(databasePath: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare('SELECT COUNT(*) AS count FROM project_stage_inventory').get();
		return Number(row?.count);
	} finally {
		database.close();
	}
}
