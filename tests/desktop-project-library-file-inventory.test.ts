/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
	mkdir,
	mkdtemp,
	readFile,
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
} from '../desktop/project-library-contract.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import { createDesktopLibraryProjectStageFile } from '../desktop/project-library-stage-inventory.ts';

const APPLICATION_ID = 0x53434150;
const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 301,
	instanceId: 'inventory-soundscaper-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 302,
	instanceId: 'inventory-framescaper-b',
});
const ENTRY_ID = 'inventory-entry-a';
const DIGEST = 'a'.repeat(64);

test('schema 3 reserves and lease-fences immutable project materialization', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 1, DIGEST);
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'b'.repeat(32));
	const stagePath = join(fixture.paths.projectsRoot, ...stageFile.split('/'));
	const finalPath = join(fixture.paths.projectsRoot, ...metadataFile.split('/'));
	await mkdir(join(fixture.paths.projectsRoot, ENTRY_ID), { recursive: true });

	library.reserveProjectFile({ lease, metadataFile, stageFile });
	assert.deepEqual({ ...readInventoryRow(fixture.paths.databasePath, metadataFile) }, {
		metadataFile,
		portableKey: metadataFile.toLowerCase(),
		state: 'planned',
		leaseId: lease.leaseId,
		fencingToken: lease.fencingToken,
	});
	await writeFile(stagePath, 'immutable project bytes');
	library.materializeProjectFile({ lease, metadataFile, stageFile });
	assert.equal((await stat(finalPath)).isFile(), true);
	await assert.rejects(() => stat(stagePath), /ENOENT/u);
	assert.equal(readInventoryRow(fixture.paths.databasePath, metadataFile)?.state, 'materialized');
	assert.equal(readUserVersion(fixture.paths.databasePath), 3);
});

test('a stale reservation cannot rename its stage after lease takeover', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 2, DIGEST);
	const staleStageFile = createDesktopLibraryProjectStageFile(metadataFile, 'c'.repeat(32));
	const staleStagePath = join(fixture.paths.projectsRoot, ...staleStageFile.split('/'));
	const finalPath = join(fixture.paths.projectsRoot, ...metadataFile.split('/'));
	await mkdir(join(fixture.paths.projectsRoot, ENTRY_ID), { recursive: true });
	first.reserveProjectFile({ lease: original, metadataFile, stageFile: staleStageFile });
	await writeFile(staleStagePath, 'stale immutable project bytes');

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	assert.throws(
		() => first.materializeProjectFile({ lease: original, metadataFile, stageFile: staleStageFile }),
		/no longer owns the lease/u,
	);
	assert.equal((await stat(staleStagePath)).isFile(), true);
	await assert.rejects(() => stat(finalPath), /ENOENT/u);

	const replacementStageFile = createDesktopLibraryProjectStageFile(metadataFile, 'd'.repeat(32));
	const replacementStagePath = join(fixture.paths.projectsRoot, ...replacementStageFile.split('/'));
	second.reserveProjectFile({ lease: replacement, metadataFile, stageFile: replacementStageFile });
	await writeFile(replacementStagePath, 'replacement immutable project bytes');
	assert.equal(first.discardProjectStageFile({
		lease: original,
		metadataFile,
		removeFile: true,
		stageFile: staleStageFile,
	}), false);
	assert.equal(await readFile(replacementStagePath, 'utf8'), 'replacement immutable project bytes');
	second.materializeProjectFile({ lease: replacement, metadataFile, stageFile: replacementStageFile });
	assert.equal((await stat(finalPath)).isFile(), true);
	assert.equal((await stat(staleStagePath)).isFile(), true);
	assert.equal(readInventoryRow(fixture.paths.databasePath, metadataFile)?.fencingToken, replacement.fencingToken);
});

test('duplicate stage registration rolls back its canonical reservation', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const firstMetadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 4, 'b'.repeat(64));
	const secondMetadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 5, 'c'.repeat(64));
	const stageFile = createDesktopLibraryProjectStageFile(firstMetadataFile, 'f'.repeat(32));

	library.reserveProjectFile({ lease, metadataFile: firstMetadataFile, stageFile });
	assert.throws(
		() => library.reserveProjectFile({ lease, metadataFile: secondMetadataFile, stageFile }),
		/UNIQUE constraint failed/u,
	);
	assert.equal(readInventoryRow(fixture.paths.databasePath, secondMetadataFile), undefined);
	assert.equal(readStageInventoryCount(fixture.paths.databasePath), 1);
});

test('an invalid stage path rolls back its canonical reservation', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 6, 'd'.repeat(64));

	assert.throws(
		() => library.reserveProjectFile({ lease, metadataFile, stageFile: '' }),
		/project stage (?:file|id) is invalid/u,
	);
	assert.equal(readInventoryRow(fixture.paths.databasePath, metadataFile), undefined);
});

test('catalog publication requires a materialized project inventory row', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const metadataFile = createDesktopLibraryProjectMetadataFile(ENTRY_ID, 3, DIGEST);
	const metadata = {
		schemaVersion: 2 as const,
		revision: 1,
		projects: [{
			id: ENTRY_ID,
			projectId: 'inventory-project-publication',
			name: 'Inventory publication project',
			metadataFile,
			preferredProduct: 'soundscaper' as const,
			updatedAtMs: fixture.clock.value,
			projectSchemaVersion: 9 as const,
			projectRevision: 3,
			byteLength: 23,
			sha256: DIGEST,
		}],
		media: [],
	};
	await assert.rejects(
		() => library.publishMetadata({ lease, metadata }),
		/materialized project file inventory/iu,
	);
	library.reserveProjectFile({ lease, metadataFile });
	await assert.rejects(
		() => library.publishMetadata({ lease, metadata }),
		/materialized project file inventory/iu,
	);
	const stageFile = createDesktopLibraryProjectStageFile(metadataFile, 'e'.repeat(32));
	await mkdir(join(fixture.paths.projectsRoot, ENTRY_ID), { recursive: true });
	library.reserveProjectFile({ lease, metadataFile, stageFile });
	await writeFile(join(fixture.paths.projectsRoot, ...stageFile.split('/')), 'materialized project row');
	library.materializeProjectFile({ lease, metadataFile, stageFile });
	assert.deepEqual(await library.publishMetadata({ lease, metadata }), metadata);
});

test('database schemas 1 and 2 are rejected without an implicit inventory migration', async (context) => {
	for (const version of [1, 2]) {
		const fixture = await createFixture(context);
		await mkdir(fixture.paths.projectsRoot, { recursive: true });
		await mkdir(fixture.paths.managedMediaRoot, { recursive: true });
		const database = new DatabaseSync(fixture.paths.databasePath);
		database.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}; PRAGMA user_version = ${String(version)};`);
		database.close();
		await assert.rejects(
			() => SharedDesktopProjectLibrary.open(fixture.paths),
			/unsupported desktop project library database version/iu,
		);
		assert.equal(readUserVersion(fixture.paths.databasePath), version);
	}
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-inventory-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

function readInventoryRow(databasePath: string, metadataFile: string) {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		return database.prepare(`
			SELECT metadata_file AS metadataFile, portable_key AS portableKey,
				state, lease_id AS leaseId, fencing_token AS fencingToken
			FROM project_file_inventory WHERE metadata_file = ?
		`).get(metadataFile);
	} finally {
		database.close();
	}
}

function readStageInventoryCount(databasePath: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare('SELECT COUNT(*) AS count FROM project_stage_inventory').get();
		return Number(row?.count);
	} finally {
		database.close();
	}
}

function readUserVersion(databasePath: string): number {
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = database.prepare('PRAGMA user_version').get();
		return Number(row?.user_version);
	} finally {
		database.close();
	}
}
