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
	createDesktopLibraryManagedMediaStageFile,
	initializeDesktopLibraryManagedMediaInventory,
	reserveDesktopLibraryManagedMediaFile,
	discardDesktopLibraryManagedMediaStageFile,
	materializeDesktopLibraryManagedMediaStageFile,
	assertDesktopLibraryManagedMediaMaterialized,
	markDesktopLibraryManagedMediaPublished,
	createDesktopLibraryManagedMediaQuarantineFile,
	consumeDesktopLibraryManagedMediaRescanRequired,
	ensureDesktopLibraryManagedMediaReclamationCycle,
	hasDesktopLibraryManagedMediaStageInventoryRows,
	markDesktopLibraryManagedMediaRescanRequired,
	readDesktopLibraryManagedMediaInventoryRow,
	readDesktopLibraryManagedMediaInventoryBatch,
	advanceDesktopLibraryManagedMediaReclamation,
	ensureDesktopLibraryManagedMediaStageReclamationCycle,
	readDesktopLibraryManagedMediaStageInventoryBatch,
	advanceDesktopLibraryManagedMediaStageReclamation,
	readDesktopLibraryManagedMediaReclamationKind,
	setDesktopLibraryManagedMediaReclamationKind,
	validateDesktopLibraryManagedMediaInventory,
	type DesktopLibraryManagedMediaReservationOptions,
} from '../desktop/project-library-media-inventory.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	type DesktopLibraryManagedMediaEncoding,
} from '../desktop/project-library-media-binding.ts';
import type { DesktopLibraryLease, DesktopLibraryMedia } from '../desktop/project-library-contract.ts';

const LEASE = Object.freeze({
	leaseId: 'a'.repeat(48),
	fencingToken: 7,
	owner: Object.freeze({ product: 'soundscaper' as const, processId: 701, instanceId: 'media-inventory-owner' }),
	acquiredAtMs: 1_000,
	expiresAtMs: 2_000,
	tookOverStaleLease: false,
});

test('reservation atomically records an exact descriptor, provenance, and canonical stage', () => {
	const database = createDatabase();
	const upload = reservation('a', 'upload');
	const reuse = reservation('b', 'reuse', DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING);

	reserveDesktopLibraryManagedMediaFile(database, upload);
	reserveDesktopLibraryManagedMediaFile(database, reuse);

	assert.deepEqual({ ...readMediaRow(database, upload.descriptor.id) }, {
		bindingId: upload.descriptor.id,
		relativeFile: upload.descriptor.relativeFile,
		portableKey: upload.descriptor.relativeFile.toLowerCase(),
		byteLength: upload.descriptor.byteLength,
		sha256: upload.descriptor.sha256,
		encoding: upload.encoding,
		projectId: upload.projectId,
		projectRevision: upload.projectRevision,
		projectSha256: upload.projectSha256,
		storageKey: upload.storageKey,
		state: 'planned',
		leaseId: LEASE.leaseId,
		fencingToken: LEASE.fencingToken,
		registeredAtMs: upload.registeredAtMs,
	});
	assert.deepEqual({ ...readStageRow(database, upload.stageFile) }, {
		bindingId: upload.descriptor.id,
		stageFile: upload.stageFile,
		portableKey: upload.stageFile.toLowerCase(),
		kind: 'upload',
		leaseId: LEASE.leaseId,
		fencingToken: LEASE.fencingToken,
		registeredAtMs: upload.registeredAtMs,
	});
	assert.match(upload.stageFile, /\/\.m[a-f0-9]{64}\.[a-f0-9]{32}\.stage$/u);
	assert.match(reuse.stageFile, /\/\.v[a-f0-9]{64}\.bin\.[a-f0-9]{32}\.reuse$/u);
	validateDesktopLibraryManagedMediaInventory(database);
	database.close();
});

test('a stage insertion failure rolls back its canonical reservation', () => {
	const database = createDatabase();
	const options = reservation('c', 'upload');
	database.exec(`
		CREATE TRIGGER reject_managed_media_stage BEFORE INSERT ON managed_media_stage_inventory
		BEGIN SELECT RAISE(ABORT, 'injected stage rejection'); END;
	`);

	assert.throws(
		() => reserveDesktopLibraryManagedMediaFile(database, options),
		/injected stage rejection/u,
	);
	assert.equal(countRows(database, 'managed_media_inventory'), 0);
	assert.equal(countRows(database, 'managed_media_stage_inventory'), 0);
	database.close();
});

test('reservation joins a caller transaction without committing it', () => {
	const database = createDatabase();
	database.exec('BEGIN IMMEDIATE');
	reserveDesktopLibraryManagedMediaFile(database, reservation('0', 'upload'));
	assert.equal(database.isTransaction, true);
	database.exec('ROLLBACK');
	assert.equal(countRows(database, 'managed_media_inventory'), 0);
	assert.equal(countRows(database, 'managed_media_stage_inventory'), 0);
	database.close();
});

test('reservation rejects provenance that does not derive the immutable binding', () => {
	const database = createDatabase();
	const options = reservation('d', 'upload');

	assert.throws(
		() => reserveDesktopLibraryManagedMediaFile(database, { ...options, storageKey: 'another-storage-key' }),
		/does not match its provenance/iu,
	);
	assert.equal(countRows(database, 'managed_media_inventory'), 0);
	database.close();
});

test('collision cleanup drops ownership without unlinking the colliding stage', async (context) => {
	const fixture = await createFixture(context, 'e', 'upload');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	await mkdir(join(fixture.root, ...fixture.options.stageFile.split('/').slice(0, -1)), { recursive: true });
	const stagePath = join(fixture.root, ...fixture.options.stageFile.split('/'));
	await writeFile(stagePath, 'foreign collision', { flag: 'wx' });

	assert.equal(discardDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
		removeFile: false,
	}), true);
	assert.equal(await readFile(stagePath, 'utf8'), 'foreign collision');
	assert.equal(countRows(fixture.database, 'managed_media_stage_inventory'), 0);
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'planned');
});

test('owned stage cleanup removes only the exact registered regular file', async (context) => {
	const fixture = await createFixture(context, 'f', 'upload');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	const stagePath = await writeRegisteredStage(fixture);

	assert.equal(discardDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
		removeFile: true,
	}), true);
	await assert.rejects(() => stat(stagePath), /ENOENT/u);
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'planned');
});

test('an exact planned row retries only after its outstanding stage is discarded', async (context) => {
	const fixture = await createFixture(context, '7', 'upload');
	const first = reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	assert.equal(first.state, 'planned');
	assert.throws(
		() => reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options),
		/outstanding stage/iu,
	);
	assert.equal(discardDesktopLibraryManagedMediaStageFile(fixture.database, '', {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
		removeFile: false,
	}), true);
	const retry = {
		...fixture.options,
		stageFile: createDesktopLibraryManagedMediaStageFile(
			fixture.options.descriptor.id,
			'8'.repeat(32),
			fixture.options.stageKind,
		),
	};
	assert.equal(reserveDesktopLibraryManagedMediaFile(fixture.database, retry).state, 'planned');
	assert.equal(readStageRow(fixture.database, retry.stageFile)?.stageFile, retry.stageFile);
});

test('materialization renames the exact stage and advances inventory state', async (context) => {
	const fixture = await createFixture(context, '1', 'upload');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	const stagePath = await writeRegisteredStage(fixture);
	const finalPath = join(fixture.root, ...fixture.options.descriptor.relativeFile.split('/'));

	fixture.database.exec('BEGIN IMMEDIATE');
	try {
		materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
			lease: LEASE,
			descriptor: fixture.options.descriptor,
			stageFile: fixture.options.stageFile,
			stageKind: fixture.options.stageKind,
		});
		fixture.database.exec('COMMIT');
	} catch (error) {
		if (fixture.database.isTransaction) fixture.database.exec('ROLLBACK');
		throw error;
	}

	assert.equal(await readFile(finalPath, 'utf8'), 'registered stage body');
	await assert.rejects(() => stat(stagePath), /ENOENT/u);
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'materialized');
	assert.equal(readStageRow(fixture.database, fixture.options.stageFile), undefined);
});

test('materialization refuses lease, stage, descriptor, and occupied-target mismatches', async (context) => {
	const fixture = await createFixture(context, '2', 'reuse');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	const stagePath = await writeRegisteredStage(fixture);
	const finalPath = join(fixture.root, ...fixture.options.descriptor.relativeFile.split('/'));
	await writeFile(finalPath, 'target winner', { flag: 'wx' });
	const staleLease = Object.freeze({ ...LEASE, fencingToken: LEASE.fencingToken + 1 });

	assert.throws(() => materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: staleLease,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
	}), /another lease/iu);
	assert.throws(() => materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: { ...fixture.options.descriptor, sha256: 'f'.repeat(64) },
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
	}), /descriptor/iu);
	assert.throws(() => materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
	}), /final path already exists/iu);
	assert.equal(await readFile(finalPath, 'utf8'), 'target winner');
	assert.equal(await readFile(stagePath, 'utf8'), 'registered stage body');
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'planned');
});

test('exact materialized and published retries transfer fencing without creating stages', async (context) => {
	const fixture = await createFixture(context, '8', 'upload');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	await writeRegisteredStage(fixture);
	materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
	});
	const nextLease = Object.freeze({ ...LEASE, leaseId: 'b'.repeat(48), fencingToken: 8 });
	const retry = reserveDesktopLibraryManagedMediaFile(fixture.database, {
		...fixture.options,
		lease: nextLease,
		registeredAtMs: 1_999,
		stageFile: createDesktopLibraryManagedMediaStageFile(
			fixture.options.descriptor.id,
			'7'.repeat(32),
			fixture.options.stageKind,
		),
	});

	assert.equal(retry.state, 'materialized');
	assert.equal(retry.leaseId, nextLease.leaseId);
	assert.equal(retry.fencingToken, nextLease.fencingToken);
	assert.equal(retry.registeredAtMs, 1_999);
	assert.equal(countRows(fixture.database, 'managed_media_stage_inventory'), 0);
	markDesktopLibraryManagedMediaPublished(fixture.database, {
		lease: nextLease,
		descriptor: fixture.options.descriptor,
	});
	const finalLease = Object.freeze({ ...LEASE, leaseId: 'c'.repeat(48), fencingToken: 9 });
	const publishedRetry = reserveDesktopLibraryManagedMediaFile(fixture.database, {
		...fixture.options,
		lease: finalLease,
		registeredAtMs: 2_001,
		stageFile: createDesktopLibraryManagedMediaStageFile(
			fixture.options.descriptor.id,
			'6'.repeat(32),
			fixture.options.stageKind,
		),
	});
	assert.equal(publishedRetry.state, 'published');
	assert.equal(publishedRetry.leaseId, finalLease.leaseId);
	assert.equal(countRows(fixture.database, 'managed_media_stage_inventory'), 0);
});

test('publication requires an exact materialized row without trusting its creator lease', async (context) => {
	const fixture = await createFixture(context, '3', 'upload');
	reserveDesktopLibraryManagedMediaFile(fixture.database, fixture.options);
	assert.throws(
		() => assertDesktopLibraryManagedMediaMaterialized(fixture.database, fixture.options.descriptor),
		/requires a materialized managed-media inventory row/iu,
	);
	await writeRegisteredStage(fixture);
	materializeDesktopLibraryManagedMediaStageFile(fixture.database, fixture.root, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
		stageFile: fixture.options.stageFile,
		stageKind: fixture.options.stageKind,
	});
	assert.doesNotThrow(
		() => assertDesktopLibraryManagedMediaMaterialized(fixture.database, fixture.options.descriptor),
	);
	markDesktopLibraryManagedMediaPublished(fixture.database, {
		lease: { ...LEASE, leaseId: 'b'.repeat(48) },
		descriptor: fixture.options.descriptor,
	});
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'published');
	markDesktopLibraryManagedMediaPublished(fixture.database, {
		lease: LEASE,
		descriptor: fixture.options.descriptor,
	});
	assert.equal(readMediaRow(fixture.database, fixture.options.descriptor.id)?.state, 'published');
	assert.doesNotThrow(
		() => assertDesktopLibraryManagedMediaMaterialized(fixture.database, fixture.options.descriptor),
	);
});

test('reclaimer helpers expose only validated ownership and persisted rescan state', () => {
	const database = createDatabase();
	const options = reservation('9', 'upload');
	const reserved = reserveDesktopLibraryManagedMediaFile(database, options);
	assert.deepEqual(
		readDesktopLibraryManagedMediaInventoryRow(database, options.descriptor.id),
		reserved,
	);
	assert.equal(
		hasDesktopLibraryManagedMediaStageInventoryRows(database, reserved.inventoryId),
		true,
	);
	const quarantine = createDesktopLibraryManagedMediaQuarantineFile(options.descriptor.relativeFile);
	assert.match(quarantine, /^audio\/[a-f0-9]{2}\/\.[a-f0-9]{64}\.orphan$/u);
	assert.throws(
		() => createDesktopLibraryManagedMediaQuarantineFile('audio/aa/foreign.f32c'),
		/managed-media binding id is invalid/iu,
	);
	assert.equal(consumeDesktopLibraryManagedMediaRescanRequired(database), false);
	markDesktopLibraryManagedMediaRescanRequired(database);
	assert.equal(consumeDesktopLibraryManagedMediaRescanRequired(database), true);
	assert.equal(consumeDesktopLibraryManagedMediaRescanRequired(database), false);
	database.close();
});

test('bounded high-water cycles exclude rows registered after the cycle starts', () => {
	const database = createDatabase();
	const first = reservation('4', 'upload');
	const second = reservation('5', 'reuse');
	const later = reservation('6', 'upload');
	reserveDesktopLibraryManagedMediaFile(database, first);
	reserveDesktopLibraryManagedMediaFile(database, second);
	ensureDesktopLibraryManagedMediaReclamationCycle(database);
	ensureDesktopLibraryManagedMediaStageReclamationCycle(database);
	reserveDesktopLibraryManagedMediaFile(database, later);

	const mediaFirst = readDesktopLibraryManagedMediaInventoryBatch(database, 1);
	assert.equal(mediaFirst.complete, false);
	assert.deepEqual(mediaFirst.rows.map(({ bindingId }) => bindingId), [first.descriptor.id]);
	advanceDesktopLibraryManagedMediaReclamation(database, mediaFirst.rows[0]?.inventoryId ?? 0, false);
	const mediaSecond = readDesktopLibraryManagedMediaInventoryBatch(database, 2);
	assert.equal(mediaSecond.complete, true);
	assert.deepEqual(mediaSecond.rows.map(({ bindingId }) => bindingId), [second.descriptor.id]);
	advanceDesktopLibraryManagedMediaReclamation(database, mediaSecond.rows[0]?.inventoryId ?? 0, true);
	assert.deepEqual(
		readDesktopLibraryManagedMediaInventoryBatch(database, 2).rows,
		[],
	);

	const stageFirst = readDesktopLibraryManagedMediaStageInventoryBatch(database, 1);
	assert.equal(stageFirst.complete, false);
	assert.deepEqual(stageFirst.rows.map(({ stageFile }) => stageFile), [first.stageFile]);
	advanceDesktopLibraryManagedMediaStageReclamation(database, stageFirst.rows[0]?.id ?? 0, false);
	const stageSecond = readDesktopLibraryManagedMediaStageInventoryBatch(database, 2);
	assert.equal(stageSecond.complete, true);
	assert.deepEqual(stageSecond.rows.map(({ stageFile }) => stageFile), [second.stageFile]);
	advanceDesktopLibraryManagedMediaStageReclamation(database, stageSecond.rows[0]?.id ?? 0, true);
	database.close();
});

test('inventory rows are validated only when a bounded batch reaches them', () => {
	const database = createDatabase();
	const first = reservation('7', 'upload');
	const corrupt = reservation('8', 'upload');
	reserveDesktopLibraryManagedMediaFile(database, first);
	reserveDesktopLibraryManagedMediaFile(database, corrupt);
	database.prepare(`
		UPDATE managed_media_inventory SET portable_key = 'wrong/path' WHERE binding_id = ?
	`).run(corrupt.descriptor.id);
	assert.doesNotThrow(() => validateDesktopLibraryManagedMediaInventory(database));
	ensureDesktopLibraryManagedMediaReclamationCycle(database);
	const firstBatch = readDesktopLibraryManagedMediaInventoryBatch(database, 1);
	assert.deepEqual(firstBatch.rows.map(({ bindingId }) => bindingId), [first.descriptor.id]);
	advanceDesktopLibraryManagedMediaReclamation(
		database,
		firstBatch.rows[0]?.inventoryId ?? 0,
		false,
	);
	assert.throws(
		() => readDesktopLibraryManagedMediaInventoryBatch(database, 1),
		/portable key is invalid/iu,
	);
	database.close();
});

test('bounded stage validation exposes orphan inventory rows', () => {
	const database = createDatabase();
	const options = reservation('9', 'reuse');
	const row = reserveDesktopLibraryManagedMediaFile(database, options);
	database.exec('PRAGMA foreign_keys = OFF');
	database.prepare('DELETE FROM managed_media_inventory WHERE id = ?').run(row.inventoryId);
	assert.doesNotThrow(() => validateDesktopLibraryManagedMediaInventory(database));
	ensureDesktopLibraryManagedMediaStageReclamationCycle(database);
	assert.throws(
		() => readDesktopLibraryManagedMediaStageInventoryBatch(database, 1),
		/managed-media binding id is invalid/iu,
	);
	database.close();
});

test('reclamation scheduling alternates only between media and stage work', () => {
	const database = createDatabase();
	assert.equal(readDesktopLibraryManagedMediaReclamationKind(database), 'stage');
	setDesktopLibraryManagedMediaReclamationKind(database, 'media');
	assert.equal(readDesktopLibraryManagedMediaReclamationKind(database), 'media');
	assert.throws(
		() => setDesktopLibraryManagedMediaReclamationKind(database, 'invalid' as 'media'),
		/reclamation kind is invalid/iu,
	);
	database.exec('DELETE FROM managed_media_reclamation_schedule');
	assert.throws(
		() => validateDesktopLibraryManagedMediaInventory(database),
		/reclamation schedule is invalid/iu,
	);
	database.close();
});

function createDatabase(): DatabaseSync {
	const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
	initializeDesktopLibraryManagedMediaInventory(database);
	return database;
}

function reservation(
	seed: string,
	stageKind: 'upload' | 'reuse',
	encoding: DesktopLibraryManagedMediaEncoding = DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
): DesktopLibraryManagedMediaReservationOptions {
	const projectId = `managed-media-project-${seed}`;
	const projectRevision = Number.parseInt(seed, 16) + 1;
	const projectSha256 = seed.repeat(64);
	const storageKey = `managed-media-storage-${seed}`;
	const binding = createDesktopLibraryMediaBinding(
		encoding,
		projectId,
		storageKey,
		projectRevision,
		projectSha256,
	);
	const descriptor = Object.freeze({
		...binding,
		byteLength: 21,
		sha256: seed.repeat(64),
	});
	return Object.freeze({
		lease: LEASE,
		descriptor,
		encoding,
		projectId,
		projectRevision,
		projectSha256,
		storageKey,
		registeredAtMs: 1_234,
		stageFile: createDesktopLibraryManagedMediaStageFile(binding.id, '9'.repeat(32), stageKind),
		stageKind,
	});
}

async function createFixture(
	context: TestContext,
	seed: string,
	stageKind: 'upload' | 'reuse',
) {
	const root = await mkdtemp(join(tmpdir(), 'scape-managed-media-inventory-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const database = createDatabase();
	context.after(() => database.close());
	return Object.freeze({ database, options: reservation(seed, stageKind), root });
}

async function writeRegisteredStage(
	fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<string> {
	const stagePath = join(fixture.root, ...fixture.options.stageFile.split('/'));
	await mkdir(join(fixture.root, ...fixture.options.stageFile.split('/').slice(0, -1)), { recursive: true });
	await writeFile(stagePath, 'registered stage body', { flag: 'wx' });
	return stagePath;
}

function readMediaRow(database: DatabaseSync, bindingId: string): Record<string, unknown> | undefined {
	return database.prepare(`
		SELECT binding_id AS bindingId, relative_file AS relativeFile, portable_key AS portableKey,
			byte_length AS byteLength, sha256, encoding, project_id AS projectId,
			project_revision AS projectRevision, project_sha256 AS projectSha256,
			storage_key AS storageKey, state, lease_id AS leaseId,
			fencing_token AS fencingToken, registered_at_ms AS registeredAtMs
		FROM managed_media_inventory WHERE binding_id = ?
	`).get(bindingId);
}

function readStageRow(database: DatabaseSync, stageFile: string): Record<string, unknown> | undefined {
	return database.prepare(`
		SELECT media.binding_id AS bindingId, stage.stage_file AS stageFile,
			stage.portable_key AS portableKey, stage.kind, stage.lease_id AS leaseId,
			stage.fencing_token AS fencingToken, stage.registered_at_ms AS registeredAtMs
		FROM managed_media_stage_inventory AS stage
		JOIN managed_media_inventory AS media ON media.id = stage.media_inventory_id
		WHERE stage.stage_file = ?
	`).get(stageFile);
}

function countRows(database: DatabaseSync, table: string): number {
	const allowed = new Set(['managed_media_inventory', 'managed_media_stage_inventory']);
	if (!allowed.has(table)) throw new TypeError('Unexpected managed-media inventory table');
	return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
}

function _mediaTypeCheck(value: DesktopLibraryMedia, lease: DesktopLibraryLease): void {
	void value;
	void lease;
}
