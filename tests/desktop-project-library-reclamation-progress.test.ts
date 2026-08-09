/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryProjectMetadataFile,
	createDesktopProjectLibraryPaths,
	type DesktopLibraryLease,
	type DesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import {
	createDesktopLibraryProjectQuarantineFile,
} from '../desktop/project-library-file-inventory.ts';
import { DesktopLibraryProjectReclaimer } from '../desktop/project-library-reclamation.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import { createDesktopLibraryProjectStageFile } from '../desktop/project-library-stage-inventory.ts';

const PRODUCTION_RECLAMATION_CAP = 100_000;
const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 401,
	instanceId: 'reclamation-progress-soundscaper-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 402,
	instanceId: 'reclamation-progress-framescaper-b',
});

test('a fixed low cap advances past a protected prefix across close and reopen', async (context) => {
	const fixture = await createFixture(context);
	let library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const firstLease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const projects = new DesktopLibraryProjectStore(library);
	const project = createAudioEditorProjectV10({
		id: 'reclamation-progress-protected-project',
		title: 'Protected reclamation progress project',
		revision: 1,
		now: '2026-07-30T12:00:00.000Z',
	});
	const protectedProject = await projects.commitProject({
		lease: firstLease,
		entryId: 'progress-protected-entry',
		name: 'Protected reclamation progress project',
		project,
		preferredProduct: 'soundscaper',
		updatedAtMs: fixture.clock.value,
	});
	const protectedPath = join(fixture.paths.projectsRoot, ...protectedProject.catalog.metadataFile.split('/'));
	const protectedInventoryId = inventoryId(fixture.paths.databasePath, protectedProject.catalog.metadataFile);
	const orphan = await materializeUnreachableFile({
		library,
		lease: firstLease,
		paths: fixture.paths,
		entryId: 'progress-orphan-entry-a',
		revision: 1,
		digest: 'a'.repeat(64),
		stageId: 'b'.repeat(32),
	});
	const orphanInventoryId = inventoryId(fixture.paths.databasePath, orphan.metadataFile);
	assert.equal(orphanInventoryId, protectedInventoryId + 1);

	const first = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: firstLease });
	assert.deepEqual(first, {
		scannedEntries: 1,
		canonicalFiles: 1,
		complete: false,
		liveStageFiles: 0,
		protectedFiles: 1,
		reclaimedFiles: 0,
		reclaimedStageFiles: 0,
		stageFiles: 0,
	});
	assert.deepEqual(readCursor(fixture.paths.databasePath), {
		lastInventoryId: protectedInventoryId,
		cycleHighWaterId: orphanInventoryId,
	});
	assert.equal(await exists(protectedPath), true);
	assert.equal(await exists(orphan.path), true);

	assert.equal(await library.releaseLease(firstLease), true);
	library.close();
	library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const replacement = await library.acquireLease({ owner: OWNER_B, ttlMs: 5_000 });
	const second = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(second.scannedEntries, 1);
	assert.equal(second.complete, true);
	assert.equal(second.protectedFiles, 0);
	assert.equal(second.reclaimedFiles, 1);
	assert.equal(await exists(protectedPath), true);
	assert.equal(await exists(orphan.path), false);
});

test('a protected row preserves its only crash-left quarantine copy', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = createAudioEditorProjectV10({
		id: 'reclamation-progress-quarantine-project',
		title: 'Protected quarantine project',
		revision: 1,
		now: '2026-07-30T12:00:00.000Z',
	});
	const committed = await new DesktopLibraryProjectStore(library).commitProject({
		lease,
		entryId: 'progress-quarantine-entry',
		name: 'Protected quarantine project',
		project,
		preferredProduct: 'soundscaper',
		updatedAtMs: fixture.clock.value,
	});
	const canonicalPath = join(fixture.paths.projectsRoot, ...committed.catalog.metadataFile.split('/'));
	const quarantinePath = join(
		fixture.paths.projectsRoot,
		...createDesktopLibraryProjectQuarantineFile(committed.catalog.metadataFile).split('/'),
	);
	await rename(canonicalPath, quarantinePath);

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now }).reclaim({ lease });
	assert.deepEqual(result, {
		scannedEntries: 1,
		canonicalFiles: 1,
		complete: true,
		liveStageFiles: 0,
		protectedFiles: 1,
		reclaimedFiles: 0,
		reclaimedStageFiles: 0,
		stageFiles: 0,
	});
	assert.equal(await exists(canonicalPath), false);
	assert.equal(await exists(quarantinePath), true);
});

test('deleted processed rows remain resumable and later inserts wait for the next high-water cycle', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const firstOrphan = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'progress-cursor-entry-a',
		revision: 1,
		digest: '1'.repeat(64),
		stageId: '2'.repeat(32),
	});
	const secondOrphan = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'progress-cursor-entry-b',
		revision: 2,
		digest: '3'.repeat(64),
		stageId: '4'.repeat(32),
	});
	const firstId = inventoryId(fixture.paths.databasePath, firstOrphan.metadataFile);
	const secondId = inventoryId(fixture.paths.databasePath, secondOrphan.metadataFile);
	fixture.clock.value = lease.expiresAtMs + 1;
	const maintenanceLease = await library.acquireLease({ owner: OWNER_B, ttlMs: 5_000 });
	const reclaimer = new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	});

	const first = await reclaimer.reclaim({ lease: maintenanceLease });
	assert.equal(first.complete, false);
	assert.equal(first.reclaimedFiles, 1);
	assert.equal(await exists(firstOrphan.path), false);
	assert.equal(inventoryRowExists(fixture.paths.databasePath, firstId), false);
	assert.deepEqual(readCursor(fixture.paths.databasePath), {
		lastInventoryId: firstId,
		cycleHighWaterId: secondId,
	});

	const laterOrphan = await materializeUnreachableFile({
		library,
		lease: maintenanceLease,
		paths: fixture.paths,
		entryId: 'progress-cursor-entry-c',
		revision: 3,
		digest: '5'.repeat(64),
		stageId: '6'.repeat(32),
	});
	const laterId = inventoryId(fixture.paths.databasePath, laterOrphan.metadataFile);
	assert.ok(laterId > secondId);

	const second = await reclaimer.reclaim({ lease: maintenanceLease });
	assert.equal(second.scannedEntries, 1);
	assert.equal(second.complete, true);
	assert.equal(second.reclaimedFiles, 1);
	assert.equal(await exists(secondOrphan.path), false);
	assert.equal(await exists(laterOrphan.path), true, 'an insert above the captured high-water waits for the next cycle');

	fixture.clock.value = maintenanceLease.expiresAtMs + 1;
	const finalLease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const third = await reclaimer.reclaim({ lease: finalLease });
	assert.equal(third.scannedEntries, 1);
	assert.equal(third.complete, true);
	assert.equal(third.reclaimedFiles, 1);
	assert.equal(await exists(laterOrphan.path), false);
});

test('unregistered foreign, stage, canonical, and quarantine files do not consume inventory budget', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const unregisteredDirectory = join(fixture.paths.projectsRoot, 'progress-unregistered-entry');
	await mkdir(unregisteredDirectory, { recursive: true });
	const unregistered = Object.freeze({
		foreign: join(unregisteredDirectory, 'notes.txt'),
		stage: join(unregisteredDirectory, `.${'7'.repeat(32)}.stage`),
		canonical: join(unregisteredDirectory, `9-${'8'.repeat(64)}.json`),
		quarantine: join(unregisteredDirectory, `.${'9'.repeat(32)}.orphan`),
	});
	await Promise.all([
		writeFile(unregistered.foreign, 'foreign file'),
		writeFile(unregistered.stage, 'unregistered stage'),
		writeFile(unregistered.canonical, 'unregistered canonical file'),
		writeFile(unregistered.quarantine, 'forged collector quarantine'),
	]);
	const registered = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'progress-registered-entry',
		revision: 1,
		digest: 'c'.repeat(64),
		stageId: 'd'.repeat(32),
	});
	fixture.clock.value = lease.expiresAtMs + 1;
	const maintenanceLease = await library.acquireLease({ owner: OWNER_B, ttlMs: 5_000 });

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease: maintenanceLease });
	assert.equal(result.scannedEntries, 1);
	assert.equal(result.complete, true);
	assert.equal(result.reclaimedFiles, 1);
	assert.equal(await exists(registered.path), false);
	assert.equal(await readFile(unregistered.foreign, 'utf8'), 'foreign file');
	assert.equal(await readFile(unregistered.stage, 'utf8'), 'unregistered stage');
	assert.equal(await readFile(unregistered.canonical, 'utf8'), 'unregistered canonical file');
	assert.equal(await readFile(unregistered.quarantine, 'utf8'), 'forged collector quarantine');
});

test('the real 100000-row cap persists progress to row 100001', {
	timeout: 60_000,
}, async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const suffixMetadataFile = seedProductionCapInventory(fixture.paths.databasePath, fixture.clock.value);
	const suffixPath = join(fixture.paths.projectsRoot, ...suffixMetadataFile.split('/'));
	await mkdir(join(fixture.paths.projectsRoot, 'progress-cap-suffix-entry'), { recursive: true });
	await writeFile(suffixPath, 'the inventory suffix must make progress');
	const reclaimer = new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now });

	const first = await reclaimer.reclaim({ lease });
	assert.equal(first.scannedEntries, PRODUCTION_RECLAMATION_CAP);
	assert.equal(first.complete, false);
	assert.equal(first.reclaimedFiles, 0);
	assert.equal(await exists(suffixPath), true);
	assert.deepEqual(readCursor(fixture.paths.databasePath), {
		lastInventoryId: PRODUCTION_RECLAMATION_CAP,
		cycleHighWaterId: PRODUCTION_RECLAMATION_CAP + 1,
	});
	assert.equal(
		inventoryCount(fixture.paths.databasePath),
		1,
		'missing planned rows below the cursor are retired instead of recurring every cycle',
	);

	const second = await reclaimer.reclaim({ lease });
	assert.equal(second.scannedEntries, 1);
	assert.equal(second.complete, true);
	assert.equal(second.reclaimedFiles, 1);
	assert.equal(await exists(suffixPath), false);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-reclamation-progress-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

async function materializeUnreachableFile(options: Readonly<{
	library: SharedDesktopProjectLibrary;
	lease: DesktopLibraryLease;
	paths: DesktopProjectLibraryPaths;
	entryId: string;
	revision: number;
	digest: string;
	stageId: string;
}>): Promise<Readonly<{ metadataFile: string; path: string }>> {
	const metadataFile = createDesktopLibraryProjectMetadataFile(options.entryId, options.revision, options.digest);
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, options.stageId);
	const directory = join(options.paths.projectsRoot, options.entryId);
	const stagePath = join(options.paths.projectsRoot, ...stageFile.split('/'));
	await mkdir(directory, { recursive: true });
	options.library.reserveProjectFile({ lease: options.lease, metadataFile, stageFile });
	await writeFile(stagePath, `unreachable project ${options.revision} ${options.stageId}`);
	options.library.materializeProjectFile({
		lease: options.lease,
		metadataFile,
		stageFile,
	});
	return Object.freeze({
		metadataFile,
		path: join(options.paths.projectsRoot, ...metadataFile.split('/')),
	});
}

function inventoryId(databasePath: string, metadataFile: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare(`
			SELECT id FROM project_file_inventory WHERE metadata_file = ?
		`).get(metadataFile);
		if (!row || typeof row.id !== 'number') throw new Error('Expected project file inventory row');
		return row.id;
	} finally {
		database.close();
	}
}

function inventoryRowExists(databasePath: string, id: number): boolean {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		return database.prepare('SELECT id FROM project_file_inventory WHERE id = ?').get(id) !== undefined;
	} finally {
		database.close();
	}
}

function inventoryCount(databasePath: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare('SELECT COUNT(*) AS count FROM project_file_inventory').get();
		if (!row || typeof row.count !== 'number') throw new Error('Expected project file inventory count');
		return row.count;
	} finally {
		database.close();
	}
}

function readCursor(databasePath: string): Readonly<{
	lastInventoryId: number;
	cycleHighWaterId: number;
}> {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare(`
			SELECT last_inventory_id AS lastInventoryId,
				cycle_high_water_id AS cycleHighWaterId
			FROM project_file_reclamation WHERE singleton = 1
		`).get();
		if (!row || typeof row.lastInventoryId !== 'number' || typeof row.cycleHighWaterId !== 'number') {
			throw new Error('Expected project file reclamation cursor');
		}
		return Object.freeze({
			lastInventoryId: row.lastInventoryId,
			cycleHighWaterId: row.cycleHighWaterId,
		});
	} finally {
		database.close();
	}
}

function seedProductionCapInventory(
	databasePath: string,
	registeredAtMs: number,
): string {
	const suffixValue = PRODUCTION_RECLAMATION_CAP + 1;
	const suffixMetadataFile = createDesktopLibraryProjectMetadataFile(
		'progress-cap-suffix-entry',
		suffixValue,
		suffixValue.toString(16).padStart(64, '0'),
	);
	const database = new DatabaseSync(databasePath);
	try {
		database.prepare(`
			WITH RECURSIVE sequence(value) AS (
				VALUES(1)
				UNION ALL
				SELECT value + 1 FROM sequence WHERE value < ?
			), objects(value, metadata_file) AS (
				SELECT value,
					(CASE WHEN value = ?
						THEN 'progress-cap-suffix-entry'
						ELSE 'progress-cap-prefix-entry'
					END) || '/' || CAST(value AS TEXT) || '-' || printf('%064x', value) || '.json'
				FROM sequence
			)
			INSERT INTO project_file_inventory (
				metadata_file, portable_key, state,
				lease_id, fencing_token, registered_at_ms
			)
			SELECT metadata_file, lower(metadata_file),
				CASE WHEN value = ? THEN 'materialized' ELSE 'planned' END,
				?, ?, ?
			FROM objects
		`).run(
			suffixValue,
			suffixValue,
			suffixValue,
			'f'.repeat(48),
			1,
			registeredAtMs,
		);
		const bounds = database.prepare(`
			SELECT COUNT(*) AS count, MIN(id) AS minimumId, MAX(id) AS maximumId
			FROM project_file_inventory
		`).get();
		assert.equal(bounds?.count, suffixValue);
		assert.equal(bounds?.minimumId, 1);
		assert.equal(bounds?.maximumId, suffixValue);
	} finally {
		database.close();
	}
	return suffixMetadataFile;
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
