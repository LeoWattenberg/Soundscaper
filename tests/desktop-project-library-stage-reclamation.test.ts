/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryProjectMetadataFile,
	createDesktopProjectLibraryPaths,
	type DesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import { DesktopLibraryProjectReclaimer } from '../desktop/project-library-reclamation.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import { createDesktopLibraryProjectStageFile } from '../desktop/project-library-stage-inventory.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 451,
	instanceId: 'stage-reclamation-soundscaper-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 452,
	instanceId: 'stage-reclamation-framescaper-b',
});

test('reclamation preserves a live registered stage and retires it after lease takeover', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const stage = await createRegisteredStage(first, original, fixture.paths, 'live-stage-entry', 1);

	const live = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: original });
	assert.equal(live.stageFiles, 1);
	assert.equal(live.liveStageFiles, 1);
	assert.equal(live.reclaimedStageFiles, 0);
	assert.equal(await exists(stage.path), true);
	assert.equal(inventoryRows(fixture.paths.databasePath), 1);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 1);

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	const retired = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(retired.stageFiles, 1);
	assert.equal(retired.liveStageFiles, 0);
	assert.equal(retired.reclaimedStageFiles, 1);
	assert.equal(retired.reclaimedFiles, 1);
	assert.equal(await exists(stage.path), false);
	assert.equal(inventoryRows(fixture.paths.databasePath), 0);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

test('reclamation retires a registered stage whose file was never created', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile('missing-stage-entry', 1, 'd'.repeat(64));
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'd'.repeat(32));
	first.reserveProjectFile({ lease: original, metadataFile, stageFile });
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 1);

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(result.stageFiles, 1);
	assert.equal(result.reclaimedStageFiles, 0);
	assert.equal(inventoryRows(fixture.paths.databasePath), 0);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

test('reclamation resumes a rename whose SQLite transaction rolled back', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile('rolled-back-stage-entry', 1, 'f'.repeat(64));
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'f'.repeat(32));
	const stagePath = join(fixture.paths.projectsRoot, ...stageFile.split('/'));
	const canonicalPath = join(fixture.paths.projectsRoot, ...metadataFile.split('/'));
	await mkdir(dirname(stagePath), { recursive: true });
	first.reserveProjectFile({ lease: original, metadataFile, stageFile });
	await writeFile(stagePath, 'renamed before database rollback');
	await rename(stagePath, canonicalPath);

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(result.stageFiles, 1);
	assert.equal(result.reclaimedStageFiles, 0);
	assert.equal(result.canonicalFiles, 1);
	assert.equal(result.reclaimedFiles, 1);
	assert.equal(await exists(canonicalPath), false);
	assert.equal(inventoryRows(fixture.paths.databasePath), 0);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

test('registered abandoned stages follow the bounded persisted inventory cursor', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const stages = [
		await createRegisteredStage(first, original, fixture.paths, 'bounded-stage-entry-a', 1),
		await createRegisteredStage(first, original, fixture.paths, 'bounded-stage-entry-b', 1),
	];
	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });

	const firstPass = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(firstPass.complete, false);
	assert.equal(firstPass.scannedEntries, 1);
	assert.equal(firstPass.reclaimedStageFiles, 1);
	assert.equal(await exists(stages[0]?.path ?? ''), false);
	assert.equal(await exists(stages[1]?.path ?? ''), true);

	const secondPass = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(secondPass.complete, false);
	assert.equal(secondPass.scannedEntries, 1);
	assert.equal(secondPass.canonicalFiles, 1);
	assert.equal(secondPass.reclaimedStageFiles, 0);
	assert.equal(await exists(stages[1]?.path ?? ''), true);

	const thirdPass = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(thirdPass.complete, false);
	assert.equal(thirdPass.reclaimedStageFiles, 1);
	assert.equal(await exists(stages[1]?.path ?? ''), false);
	const fourthPass = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(fourthPass.complete, false);
	assert.equal(fourthPass.canonicalFiles, 1);
	const complete = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(complete.complete, true);
	assert.equal(complete.scannedEntries, 0);
	assert.equal(inventoryRows(fixture.paths.databasePath), 0);
});

test('a completed stage cycle revisits canonical rows that its cleanup unblocked', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	await createRegisteredStage(first, original, fixture.paths, 'rescan-stage-entry-a', 1);
	await createRegisteredStage(first, original, fixture.paths, 'rescan-stage-entry-b', 1);
	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });

	const interrupted = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(interrupted.reclaimedStageFiles, 1);
	assert.equal(interrupted.complete, false);
	const completed = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 10,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(completed.complete, true);
	assert.equal(completed.reclaimedStageFiles, 1);
	assert.equal(inventoryRows(fixture.paths.databasePath), 0);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

test('a non-regular registered stage fails closed and remains inventoried', {
	skip: process.platform === 'win32',
}, async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile('symlink-stage-entry', 1, 'c'.repeat(64));
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'c'.repeat(32));
	const stagePath = join(fixture.paths.projectsRoot, ...stageFile.split('/'));
	const outside = join(dirname(fixture.paths.libraryRoot), 'outside-stage-target');
	await mkdir(dirname(stagePath), { recursive: true });
	await writeFile(outside, 'outside stage target');
	first.reserveProjectFile({ lease: original, metadataFile, stageFile });
	await symlink(outside, stagePath, 'file');
	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(result.reclaimedStageFiles, 0);
	assert.equal((await lstat(stagePath)).isSymbolicLink(), true);
	assert.equal(await readFile(outside, 'utf8'), 'outside stage target');
	assert.equal(inventoryRows(fixture.paths.databasePath), 1);
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 1);
});

test('unregistered stage-looking files remain outside reclamation ownership', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile('foreign-stage-entry', 1, 'e'.repeat(64));
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'e'.repeat(32));
	const stagePath = join(fixture.paths.projectsRoot, ...stageFile.split('/'));
	await mkdir(dirname(stagePath), { recursive: true });
	await writeFile(stagePath, 'unregistered stage-looking bytes');

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease });
	assert.equal(result.stageFiles, 0);
	assert.equal(await readFile(stagePath, 'utf8'), 'unregistered stage-looking bytes');
	assert.equal(stageInventoryRows(fixture.paths.databasePath), 0);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-stage-reclamation-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

async function createRegisteredStage(
	library: SharedDesktopProjectLibrary,
	lease: Parameters<SharedDesktopProjectLibrary['reserveProjectFile']>[0]['lease'],
	paths: DesktopProjectLibraryPaths,
	entryId: string,
	revision: number,
) {
	const metadataFile = createDesktopLibraryProjectMetadataFile(entryId, revision, entryId.endsWith('a')
		? 'a'.repeat(64)
		: 'b'.repeat(64));
	const stageId = entryId.endsWith('a') ? 'a'.repeat(32) : 'b'.repeat(32);
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, stageId);
	const path = join(paths.projectsRoot, ...stageFile.split('/'));
	await mkdir(dirname(path), { recursive: true });
	library.reserveProjectFile({ lease, metadataFile, stageFile });
	await writeFile(path, `stage ${entryId}`);
	return Object.freeze({ metadataFile, path });
}

function inventoryRows(databasePath: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare('SELECT COUNT(*) AS count FROM project_file_inventory').get();
		return Number(row?.count);
	} finally {
		database.close();
	}
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

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}
