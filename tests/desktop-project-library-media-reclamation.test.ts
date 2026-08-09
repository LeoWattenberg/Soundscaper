/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
	link,
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
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryManagedMediaStageFile,
	createDesktopLibraryManagedMediaQuarantineFile,
	markDesktopLibraryManagedMediaPublished,
	materializeDesktopLibraryManagedMediaStageFile,
	reserveDesktopLibraryManagedMediaFile,
	type DesktopLibraryManagedMediaStageKind,
} from '../desktop/project-library-media-inventory.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
} from '../desktop/project-library-media-binding.ts';
import {
	DesktopLibraryManagedMediaReclaimer,
	type DesktopLibraryManagedMediaCatalogPort,
} from '../desktop/project-library-media-reclamation.ts';
import {
	createDesktopProjectLibraryPaths,
	type DesktopLibraryLease,
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	type DesktopLibraryProject,
	type DesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 801,
	instanceId: 'managed-media-reclamation-owner-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 802,
	instanceId: 'managed-media-reclamation-owner-b',
});

test('stale catalog retirement fully settles its metadata journal before deleting a body', async (context) => {
	const prepared = deferred<void>();
	const release = deferred<void>();
	let pauseRetirement = false;
	const fixture = await createFixture(context, async (phase) => {
		if (pauseRetirement && phase === 'prepared') {
			prepared.resolve();
			await release.promise;
		}
	});
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const first = await commitRevision(fixture.library, lease, 1);
	const tracked = await materializeTrackedMedia(fixture, lease, first, 'journal-body', 'a');
	await publishMedia(fixture.library, lease, [tracked.descriptor]);
	markPublished(fixture.paths, lease, tracked.descriptor);
	await commitRevision(fixture.library, lease, 2);
	withDatabase(fixture.paths.databasePath, (database) => {
		const inventoryId = Number(database.prepare(`
			SELECT id FROM managed_media_inventory WHERE binding_id = ?
		`).get(tracked.descriptor.id)?.id);
		database.prepare(`
			UPDATE managed_media_reclamation
			SET last_inventory_id = ?, cycle_high_water_id = ? WHERE singleton = 1
		`).run(inventoryId, inventoryId);
	});
	const replacement = await takeOver(fixture, lease);
	const catalog = catalogPort(fixture.library, replacement);
	const canonicalPath = mediaPath(fixture.paths, tracked.descriptor);
	assert.equal(await exists(canonicalPath), true);

	pauseRetirement = true;
	const reclamation = new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog,
		now: fixture.now,
	}).reclaim({ lease: replacement });
	await prepared.promise;
	assert.equal(await exists(canonicalPath), true, 'prepared retirement must not start physical deletion');
	assert.equal(journalState(fixture.paths.databasePath), 'prepared');
	release.resolve();
	const result = await reclamation;

	assert.equal(result.catalogRowsRetired, 1);
	assert.equal(result.reclaimedFiles, 1);
	assert.equal(await exists(canonicalPath), false);
	assert.deepEqual(fixture.library.readMetadata().media, []);
});

test('retiring a stale hard-link name preserves the live revision body and catalog row', async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const first = await commitRevision(fixture.library, lease, 1);
	const stale = await materializeTrackedMedia(fixture, lease, first, 'shared-inode-body', 'b');
	await publishMedia(fixture.library, lease, [stale.descriptor]);
	markPublished(fixture.paths, lease, stale.descriptor);
	const second = await commitRevision(fixture.library, lease, 2);
	const live = await materializeTrackedMedia(
		fixture,
		lease,
		second,
		'shared-inode-body',
		'c',
		mediaPath(fixture.paths, stale.descriptor),
	);
	await publishMedia(fixture.library, lease, [stale.descriptor, live.descriptor]);
	markPublished(fixture.paths, lease, live.descriptor);
	const stalePath = mediaPath(fixture.paths, stale.descriptor);
	const livePath = mediaPath(fixture.paths, live.descriptor);
	const [staleBefore, liveBefore] = await Promise.all([stat(stalePath), stat(livePath)]);
	assert.equal(staleBefore.ino, liveBefore.ino);
	const replacement = await takeOver(fixture, lease);

	const result = await new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog: catalogPort(fixture.library, replacement),
		now: fixture.now,
	}).reclaim({ lease: replacement });

	assert.equal(result.catalogRowsRetired, 1);
	assert.equal(result.reclaimedFiles, 1);
	assert.equal(await exists(stalePath), false);
	assert.equal(await readFile(livePath, 'utf8'), 'shared-inode-body');
	assert.deepEqual(fixture.library.readMetadata().media, [live.descriptor]);
});

test('a tracked catalog descriptor disagreement fails closed before filesystem mutation', async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = await commitRevision(fixture.library, lease, 1);
	const tracked = await materializeTrackedMedia(fixture, lease, project, 'conflict-body', '7');
	await publishMedia(fixture.library, lease, [tracked.descriptor]);
	markPublished(fixture.paths, lease, tracked.descriptor);
	const current = fixture.library.readMetadata();
	replacePersistedMetadata(fixture.paths.databasePath, {
		...current,
		media: [{ ...tracked.descriptor, byteLength: tracked.descriptor.byteLength + 1 }],
	});
	const replacement = await takeOver(fixture, lease);
	const canonicalPath = mediaPath(fixture.paths, tracked.descriptor);

	await assert.rejects(
		() => new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
			catalog: catalogPort(fixture.library, replacement),
			now: fixture.now,
		}).reclaim({ lease: replacement }),
		/catalog descriptor conflicts with its inventory row/iu,
	);
	assert.equal(await readFile(canonicalPath, 'utf8'), 'conflict-body');
});

test('host recovery refuses a current managed descriptor whose inventory is missing', async (context) => {
	let interrupt = false;
	const fixture = await createFixture(context, (phase) => {
		if (interrupt && phase === 'prepared') throw new Error('simulated retirement interruption');
	});
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = await commitRevision(fixture.library, lease, 1);
	const tracked = await materializeTrackedMedia(fixture, lease, project, 'recoverable-body', '8');
	await publishMedia(fixture.library, lease, [tracked.descriptor]);
	const current = fixture.library.readMetadata();
	interrupt = true;
	await assert.rejects(
		() => fixture.library.publishMetadata({
			lease,
			metadata: { ...current, revision: current.revision + 1 },
		}),
		/simulated retirement interruption/u,
	);
	withDatabase(fixture.paths.databasePath, (database) => {
		database.prepare('DELETE FROM managed_media_inventory WHERE binding_id = ?')
			.run(tracked.descriptor.id);
	});
	await fixture.library.releaseLease(lease);
	fixture.library.close();
	const canonicalPath = mediaPath(fixture.paths, tracked.descriptor);

	await assert.rejects(
		() => DesktopProjectLibraryHost.start({ appDataPath: fixture.appDataRoot, owner: OWNER_B }),
		/catalog requires materialized inventory/iu,
	);
	assert.equal(await readFile(canonicalPath, 'utf8'), 'recoverable-body');
	withDatabase(fixture.paths.databasePath, (database) => {
		assert.equal(database.prepare('SELECT active FROM library_lease WHERE singleton = 1').get()?.active, 0);
		assert.equal(database.prepare(`
			SELECT count(*) AS count FROM metadata_journal WHERE state IN ('prepared', 'committed')
		`).get()?.count, 0);
	});
});

test('logical retirement preserves unmanaged catalog descriptors', async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const opaque = Object.freeze({
		id: 'managed-media-1',
		relativeFile: 'legacy/managed-media-1.wav',
		byteLength: 12,
		sha256: 'f'.repeat(64),
	});
	await publishMedia(fixture.library, lease, [opaque]);
	const replacement = await takeOver(fixture, lease);

	const result = await new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog: catalogPort(fixture.library, replacement),
		now: fixture.now,
	}).reclaim({ lease: replacement });

	assert.equal(result.catalogRowsRetired, 0);
	assert.deepEqual(fixture.library.readMetadata().media, [opaque]);
});

test('stage reclamation removes registered stale files but preserves foreign lookalikes and symlinks', {
	skip: process.platform === 'win32',
}, async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = await commitRevision(fixture.library, lease, 1);
	const upload = await reserveTrackedStage(fixture, lease, project, 'upload', 'd', 'registered upload');
	const reuse = await reserveTrackedStage(fixture, lease, project, 'reuse', 'e', 'registered reuse');
	const symlinked = await reserveTrackedStage(fixture, lease, project, 'upload', 'f', null);
	const foreignPath = join(
		dirnameForRelative(fixture.paths.managedMediaRoot, upload.stageFile),
		`.m${'9'.repeat(64)}.${'8'.repeat(32)}.stage`,
	);
	await writeFile(foreignPath, 'foreign lookalike', { flag: 'wx' });
	const outsidePath = join(fixture.appDataRoot, 'outside-stage');
	await writeFile(outsidePath, 'outside');
	const symlinkPath = join(fixture.paths.managedMediaRoot, ...symlinked.stageFile.split('/'));
	await symlink(outsidePath, symlinkPath, 'file');
	const replacement = await takeOver(fixture, lease);

	const result = await new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog: catalogPort(fixture.library, replacement),
		now: fixture.now,
	}).reclaim({ lease: replacement });

	assert.equal(result.stageFiles, 3);
	assert.equal(result.reclaimedStageFiles, 2);
	assert.equal(await exists(upload.path), false);
	assert.equal(await exists(reuse.path), false);
	assert.equal(await readFile(foreignPath, 'utf8'), 'foreign lookalike');
	assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
	assert.equal(await readFile(outsidePath, 'utf8'), 'outside');
});

test('reclamation resumes crash-left promotion and quarantine states', async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = await commitRevision(fixture.library, lease, 1);
	const promoted = await reserveTrackedStage(fixture, lease, project, 'upload', '2', 'promoted body');
	const promotedPath = mediaPath(fixture.paths, promoted.descriptor);
	await rename(promoted.path, promotedPath);
	const quarantined = await materializeTrackedMedia(fixture, lease, project, 'quarantined body', '3');
	const quarantinedPath = mediaPath(fixture.paths, quarantined.descriptor);
	const quarantinePath = join(
		fixture.paths.managedMediaRoot,
		...createDesktopLibraryManagedMediaQuarantineFile(quarantined.descriptor.relativeFile).split('/'),
	);
	await rename(quarantinedPath, quarantinePath);
	const replacement = await takeOver(fixture, lease);

	const result = await new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog: catalogPort(fixture.library, replacement),
		now: fixture.now,
	}).reclaim({ lease: replacement });

	assert.equal(result.stageFiles, 1);
	assert.equal(result.reclaimedStageFiles, 0);
	assert.equal(result.canonicalFiles, 2);
	assert.equal(result.reclaimedFiles, 2);
	assert.equal(await exists(promotedPath), false);
	assert.equal(await exists(quarantinePath), false);
	assert.equal(inventoryCount(fixture.paths.databasePath), 0);
});

test('a lower-only entry cap persists stage-first progress and resumes canonical cleanup', async (context) => {
	const fixture = await createFixture(context);
	const lease = await fixture.library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const project = await commitRevision(fixture.library, lease, 1);
	const stage = await reserveTrackedStage(fixture, lease, project, 'upload', '1', 'bounded stage');
	const replacement = await takeOver(fixture, lease);
	const reclaimer = new DesktopLibraryManagedMediaReclaimer(fixture.paths, {
		catalog: catalogPort(fixture.library, replacement),
		maximumEntries: 1,
		now: fixture.now,
	});

	const first = await reclaimer.reclaim({ lease: replacement });
	assert.equal(first.scannedEntries, 1);
	assert.equal(first.stageFiles, 1);
	assert.equal(first.reclaimedStageFiles, 1);
	assert.equal(first.complete, false);
	assert.equal(await exists(stage.path), false);
	assert.deepEqual(reclamationCursor(fixture.paths.databasePath, 'managed_media_stage_reclamation'), {
		lastInventoryId: 0,
		cycleHighWaterId: 0,
	});

	const second = await reclaimer.reclaim({ lease: replacement });
	assert.equal(second.scannedEntries, 1);
	assert.equal(second.canonicalFiles, 1);
	assert.equal(second.complete, false);
	assert.equal(inventoryCount(fixture.paths.databasePath), 0);
	const final = await reclaimer.reclaim({ lease: replacement });
	assert.equal(final.complete, true);
});

interface Fixture {
	readonly appDataRoot: string;
	readonly clock: { value: number };
	readonly library: SharedDesktopProjectLibrary;
	readonly now: () => number;
	readonly paths: DesktopProjectLibraryPaths;
}

interface TrackedMedia {
	readonly descriptor: DesktopLibraryMedia;
	readonly stageFile: string;
}

interface TrackedStage extends TrackedMedia {
	readonly path: string;
}

async function createFixture(
	context: TestContext,
	checkpoint: (phase: 'prepared' | 'committed') => void | Promise<void> = () => {},
): Promise<Fixture> {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-managed-media-reclamation-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	const paths = createDesktopProjectLibraryPaths(appDataRoot);
	const library = await SharedDesktopProjectLibrary.open(paths, { checkpoint, now: () => clock.value });
	context.after(() => library.close());
	return Object.freeze({ appDataRoot, clock, library, now: () => clock.value, paths });
}

async function commitRevision(
	library: SharedDesktopProjectLibrary,
	lease: DesktopLibraryLease,
	revision: number,
): Promise<DesktopLibraryProject> {
	const project = createCurrentAudioEditorProject({
		id: 'managed-media-reclamation-project',
		title: 'Managed media reclamation project',
		revision,
		now: '2026-08-02T10:00:00.000Z',
	});
	const committed = await new DesktopLibraryProjectStore(library).commitProject({
		lease,
		entryId: 'managed-media-reclamation-entry',
		name: 'Managed media reclamation project',
		project,
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_000 + revision,
	});
	return committed.catalog;
}

async function materializeTrackedMedia(
	fixture: Fixture,
	lease: DesktopLibraryLease,
	project: DesktopLibraryProject,
	contents: string,
	stageDigit: string,
	donorPath?: string,
): Promise<TrackedMedia> {
	const stage = await reserveTrackedStage(
		fixture,
		lease,
		project,
		donorPath ? 'reuse' : 'upload',
		stageDigit,
		donorPath ? null : contents,
		contents,
	);
	if (donorPath) await link(donorPath, stage.path);
	withDatabase(fixture.paths.databasePath, (database) => {
		materializeDesktopLibraryManagedMediaStageFile(database, fixture.paths.managedMediaRoot, {
			lease,
			descriptor: stage.descriptor,
			stageFile: stage.stageFile,
			stageKind: donorPath ? 'reuse' : 'upload',
		});
	});
	return Object.freeze({ descriptor: stage.descriptor, stageFile: stage.stageFile });
}

async function reserveTrackedStage(
	fixture: Fixture,
	lease: DesktopLibraryLease,
	project: DesktopLibraryProject,
	stageKind: DesktopLibraryManagedMediaStageKind,
	stageDigit: string,
	contents: string | null,
	bodyContents = contents ?? 'planned stage body',
): Promise<TrackedStage> {
	const storageKey = `${stageKind}-storage-${stageDigit}`;
	const binding = createDesktopLibraryMediaBinding(
		DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		project.projectId,
		storageKey,
		project.projectRevision,
		project.sha256,
	);
	const bytes = Buffer.from(bodyContents, 'utf8');
	const descriptor = Object.freeze({
		...binding,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
	const stageFile = createDesktopLibraryManagedMediaStageFile(
		descriptor.id,
		stageDigit.repeat(32),
		stageKind,
	);
	withDatabase(fixture.paths.databasePath, (database) => {
		reserveDesktopLibraryManagedMediaFile(database, {
			lease,
			descriptor,
			encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
			projectId: project.projectId,
			projectRevision: project.projectRevision,
			projectSha256: project.sha256,
			storageKey,
			registeredAtMs: fixture.clock.value,
			stageFile,
			stageKind,
		});
	});
	const path = join(fixture.paths.managedMediaRoot, ...stageFile.split('/'));
	await mkdir(dirnameForRelative(fixture.paths.managedMediaRoot, stageFile), { recursive: true });
	if (contents !== null) await writeFile(path, contents, { flag: 'wx' });
	return Object.freeze({ descriptor, path, stageFile });
}

async function publishMedia(
	library: SharedDesktopProjectLibrary,
	lease: DesktopLibraryLease,
	media: readonly DesktopLibraryMedia[],
): Promise<DesktopLibraryMetadata> {
	const current = library.readMetadata();
	return library.publishMetadata({
		lease,
		metadata: { ...current, revision: current.revision + 1, media },
	});
}

function markPublished(
	paths: DesktopProjectLibraryPaths,
	lease: DesktopLibraryLease,
	descriptor: DesktopLibraryMedia,
): void {
	withDatabase(paths.databasePath, (database) => {
		markDesktopLibraryManagedMediaPublished(database, { lease, descriptor });
	});
}

async function takeOver(fixture: Fixture, lease: DesktopLibraryLease): Promise<DesktopLibraryLease> {
	fixture.clock.value = lease.expiresAtMs + 1;
	return fixture.library.acquireLease({ owner: OWNER_B, ttlMs: 5_000 });
}

function catalogPort(
	library: SharedDesktopProjectLibrary,
	lease: DesktopLibraryLease,
): DesktopLibraryManagedMediaCatalogPort {
	const port: DesktopLibraryManagedMediaCatalogPort = {
		readMetadata: () => library.readMetadata(),
		publishMetadata: (metadata, signal) => library.publishMetadata({ lease, metadata, signal }),
	};
	return Object.freeze(port);
}

function withDatabase<Result>(path: string, operation: (database: DatabaseSync) => Result): Result {
	const database = new DatabaseSync(path, {
		allowExtension: false,
		enableDoubleQuotedStringLiterals: false,
		enableForeignKeyConstraints: true,
	});
	try {
		return operation(database);
	} finally {
		database.close();
	}
}

function mediaPath(paths: DesktopProjectLibraryPaths, descriptor: DesktopLibraryMedia): string {
	return join(paths.managedMediaRoot, ...descriptor.relativeFile.split('/'));
}

function dirnameForRelative(root: string, relativeFile: string): string {
	return join(root, ...relativeFile.split('/').slice(0, -1));
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(() => true, () => false);
}

function journalState(path: string): unknown {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		return database.prepare(`
			SELECT state FROM metadata_journal ORDER BY created_at_ms DESC, transaction_id DESC LIMIT 1
		`).get()?.state;
	} finally {
		database.close();
	}
}

function inventoryCount(path: string): number {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		return Number(database.prepare('SELECT COUNT(*) AS count FROM managed_media_inventory').get()?.count);
	} finally {
		database.close();
	}
}

function replacePersistedMetadata(path: string, metadata: DesktopLibraryMetadata): void {
	const json = JSON.stringify(metadata);
	const digest = createHash('sha256').update(json, 'utf8').digest('hex');
	const database = new DatabaseSync(path);
	try {
		database.prepare(`
			UPDATE library_metadata SET json = ?, digest = ? WHERE singleton = 1
		`).run(json, digest);
	} finally {
		database.close();
	}
}

function reclamationCursor(path: string, table: string) {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const raw = database.prepare(`
			SELECT last_inventory_id AS lastInventoryId, cycle_high_water_id AS cycleHighWaterId
			FROM ${table} WHERE singleton = 1
		`).get();
		return { lastInventoryId: Number(raw?.lastInventoryId), cycleHighWaterId: Number(raw?.cycleHighWaterId) };
	} finally {
		database.close();
	}
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}
