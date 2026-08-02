/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createDesktopProjectLibraryPaths } from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import {
	DesktopLibraryProjectStore,
	type DesktopLibraryLoadedProject,
} from '../desktop/project-library-projects.ts';
import { DesktopLibraryLeaseBusyError } from '../desktop/project-library-api.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
} from '../desktop/project-library-media.ts';
import {
	createDesktopLibraryManagedMediaStageFile,
	reserveDesktopLibraryManagedMediaFile,
} from '../desktop/project-library-media-inventory.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const SOUNDSCAPER_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'soundscaper-host-instance',
});
const FRAMESCAPER_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'framescaper-host-instance',
});

test('desktop host opens the product-neutral appData library and releases it on close', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.deepEqual(host.snapshot(), {
		closed: false,
		owner: SOUNDSCAPER_OWNER,
		fencingToken: 1,
		tookOverStaleLease: false,
		recovery: {
			outcome: 'clean',
			previousRevision: null,
			publishedRevision: null,
			restoredPrevious: false,
		},
		reclamation: {
			canonicalFiles: 0,
			complete: true,
			liveStageFiles: 0,
			protectedFiles: 0,
			reclaimedFiles: 0,
			reclaimedStageFiles: 0,
			scannedEntries: 0,
			stageFiles: 0,
		},
		managedMediaReclamation: {
			canonicalFiles: 0,
			catalogRowsRetired: 0,
			complete: true,
			liveStageFiles: 0,
			protectedFiles: 0,
			reclaimedFiles: 0,
			reclaimedStageFiles: 0,
			scannedEntries: 0,
			stageFiles: 0,
		},
	});

	const observer = await SharedDesktopProjectLibrary.open(createDesktopProjectLibraryPaths(appDataPath));
	context.after(() => observer.close());
	await assert.rejects(
		() => observer.acquireLease({ owner: FRAMESCAPER_OWNER, ttlMs: 1_000 }),
		(error: unknown) => error instanceof DesktopLibraryLeaseBusyError
			&& error.holder.owner.product === 'soundscaper',
	);
	await host.close();
	const replacement = await observer.acquireLease({ owner: FRAMESCAPER_OWNER, ttlMs: 1_000 });
	assert.equal(replacement.owner.product, 'framescaper');
	await observer.releaseLease(replacement);
	assert.equal(host.snapshot().closed, true);
});

test('desktop host completes interrupted metadata recovery before returning', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-recovery-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const initial = await SharedDesktopProjectLibrary.open(paths);
	let lease = await initial.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await initial.publishMetadata({ lease, metadata: metadata(1) });
	await initial.releaseLease(lease);
	initial.close();

	const interrupted = await SharedDesktopProjectLibrary.open(paths, {
		checkpoint: (phase) => {
			if (phase === 'prepared') throw new Error('simulated interruption');
		},
	});
	lease = await interrupted.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await assert.rejects(
		() => interrupted.publishMetadata({ lease, metadata: metadata(2) }),
		/simulated interruption/u,
	);
	await interrupted.releaseLease(lease);
	interrupted.close();

	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: FRAMESCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.deepEqual(host.snapshot().recovery, {
		outcome: 'interrupted',
		previousRevision: 1,
		publishedRevision: null,
		restoredPrevious: false,
	});
	const observer = await SharedDesktopProjectLibrary.open(paths);
	context.after(() => observer.close());
	assert.deepEqual(observer.readMetadata(), metadata(1));
});

test('desktop host cleans up a lease when startup recovery fails', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-failure-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const corrupting = await SharedDesktopProjectLibrary.open(paths, {
		checkpoint: (phase) => {
			if (phase === 'prepared') throw new Error('simulated interruption');
		},
	});
	const lease = await corrupting.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await assert.rejects(
		() => corrupting.publishMetadata({ lease, metadata: metadata(1) }),
		/simulated interruption/u,
	);
	await corrupting.releaseLease(lease);
	corrupting.close();

	const database = await import('node:sqlite');
	const raw = new database.DatabaseSync(paths.databasePath);
	raw.prepare("UPDATE metadata_journal SET previous_digest = 'invalid' WHERE state = 'prepared'").run();
	raw.close();
	await assert.rejects(
		() => DesktopProjectLibraryHost.start({ appDataPath, owner: FRAMESCAPER_OWNER }),
		/journal previous metadata|digest/u,
	);
	const observer = await SharedDesktopProjectLibrary.open(paths).catch(() => null);
	assert.equal(observer, null, 'corrupt recovery input remains fail-closed');
});

test('desktop host suppresses a queued renewal failure after intentional close', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-close-race-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const prototype = SharedDesktopProjectLibrary.prototype as unknown as {
		renewLease: SharedDesktopProjectLibrary['renewLease'];
	};
	const originalRenewLease = prototype.renewLease;
	let rejectRenewal: ((error: Error) => void) | undefined;
	let renewalStarted: (() => void) | undefined;
	const started = new Promise<void>((resolvePromise) => { renewalStarted = resolvePromise; });
	prototype.renewLease = () => new Promise((_resolvePromise, reject) => {
		rejectRenewal = reject;
		renewalStarted?.();
	});
	context.after(() => { prototype.renewLease = originalRenewLease; });
	const leaseLosses: unknown[] = [];
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
		onLeaseLost: (error) => { leaseLosses.push(error); },
	});
	context.after(() => host.close());

	await started;
	const closing = host.close();
	rejectRenewal?.(new Error('queued renewal failure'));
	await closing;
	await delay(0);
	assert.deepEqual(leaseLosses, []);
});

test('managed-media publication rejects a recreated same-revision project digest before body I/O', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-media-digest-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	const prototype = DesktopLibraryProjectStore.prototype;
	const originalRead = prototype.readProjectById;
	prototype.readProjectById = async () => ({
		catalog: { projectRevision: 4, sha256: 'b'.repeat(64) },
		project: {},
	}) as DesktopLibraryLoadedProject;
	context.after(() => { prototype.readProjectById = originalRead; });
	const bytes = Uint8Array.of(1, 2, 3, 4);
	let chunksRead = 0;

	await assert.rejects(host.publishManagedAudio({
		projectId: 'recreated-project',
		storageKey: 'managed-source',
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		expectedProjectRevision: 4,
		expectedProjectSha256: 'a'.repeat(64),
		chunks: (async function* () { chunksRead += 1; yield bytes; })(),
	}), /changed during managed-media preparation/iu);
	assert.equal(chunksRead, 0);
});

test('managed original-video publication uses the same revision and document-digest fence', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-video-digest-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	const prototype = DesktopLibraryProjectStore.prototype;
	const originalRead = prototype.readProjectById;
	prototype.readProjectById = async () => ({
		catalog: { projectRevision: 5, sha256: 'c'.repeat(64) },
		project: {},
	}) as DesktopLibraryLoadedProject;
	context.after(() => { prototype.readProjectById = originalRead; });
	let chunksRead = 0;

	await assert.rejects(host.publishManagedMedia({
		encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		projectId: 'recreated-video-project',
		storageKey: 'managed-video-source',
		byteLength: 4,
		sha256: 'd'.repeat(64),
		expectedProjectRevision: 5,
		expectedProjectSha256: 'b'.repeat(64),
		chunks: (async function* () { chunksRead += 1; yield Uint8Array.of(1, 2, 3, 4); })(),
	}), /changed during managed-media preparation/iu);
	assert.equal(chunksRead, 0);
});

test('managed-media publication persists ownership before consuming its body', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-media-inventory-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	const prototype = DesktopLibraryProjectStore.prototype;
	const originalRead = prototype.readProjectById;
	const projectId = 'inventoried-project';
	const projectRevision = 6;
	const projectSha256 = 'e'.repeat(64);
	prototype.readProjectById = async () => ({
		catalog: { projectRevision, sha256: projectSha256 },
		project: {},
	}) as DesktopLibraryLoadedProject;
	context.after(() => { prototype.readProjectById = originalRead; });
	const bytes = Uint8Array.of(9, 8, 7, 6);
	const binding = createDesktopLibraryAudioMediaBinding(
		projectId,
		'inventory-source',
		projectRevision,
		projectSha256,
	);
	let ownershipObserved = false;

	const descriptor = await host.publishManagedAudio({
		projectId,
		storageKey: 'inventory-source',
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		expectedProjectRevision: projectRevision,
		expectedProjectSha256: projectSha256,
		chunks: (async function* () {
			const database = new DatabaseSync(paths.databasePath, { readOnly: true });
			try {
				const inventory = database.prepare(`
					SELECT binding_id AS bindingId, project_id AS projectId,
						project_revision AS projectRevision, project_sha256 AS projectSha256,
						storage_key AS storageKey, state
					FROM managed_media_inventory
				`).get();
				assert.deepEqual({ ...inventory }, {
					bindingId: binding.id,
					projectId,
					projectRevision,
					projectSha256,
					storageKey: 'inventory-source',
					state: 'planned',
				});
				assert.equal(database.prepare(`
					SELECT count(*) AS count FROM managed_media_stage_inventory WHERE kind = 'upload'
				`).get()?.count, 1);
				ownershipObserved = true;
			} finally {
				database.close();
			}
			yield bytes;
		})(),
	});
	assert.equal(ownershipObserved, true);
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	try {
		assert.deepEqual({ ...database.prepare(`
			SELECT binding_id AS bindingId, state FROM managed_media_inventory
		`).get() }, { bindingId: descriptor.id, state: 'published' });
		assert.equal(database.prepare(`
			SELECT count(*) AS count FROM managed_media_stage_inventory
		`).get()?.count, 0);
	} finally {
		database.close();
	}
});

test('host startup reclaims stale planned media before admitting an exact retry', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-stale-media-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const initial = await SharedDesktopProjectLibrary.open(paths);
	const staleLease = await initial.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	const projectId = 'stale-media-project';
	const projectRevision = 2;
	const projectSha256 = 'a'.repeat(64);
	const planned = [
		{ body: Uint8Array.of(1, 2, 3), stageKind: 'upload' as const, stageSeed: 'a', storageKey: 'upload' },
		{ body: Uint8Array.of(4, 5, 6), stageKind: 'reuse' as const, stageSeed: 'b', storageKey: 'reuse' },
	].map(({ body, stageKind, stageSeed, storageKey }) => {
		const binding = createDesktopLibraryAudioMediaBinding(
			projectId,
			storageKey,
			projectRevision,
			projectSha256,
		);
		return Object.freeze({
			body,
			descriptor: Object.freeze({
				...binding,
				byteLength: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex'),
			}),
			stageFile: createDesktopLibraryManagedMediaStageFile(
				binding.id,
				stageSeed.repeat(32),
				stageKind,
			),
			stageKind,
			storageKey,
		});
	});
	const database = new DatabaseSync(paths.databasePath);
	try {
		for (const item of planned) {
			reserveDesktopLibraryManagedMediaFile(database, {
				lease: staleLease,
				descriptor: item.descriptor,
				encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
				projectId,
				projectRevision,
				projectSha256,
				storageKey: item.storageKey,
				registeredAtMs: staleLease.acquiredAtMs,
				stageFile: item.stageFile,
				stageKind: item.stageKind,
			});
		}
	} finally {
		database.close();
	}
	for (const item of planned) {
		const segments = item.stageFile.split('/');
		await mkdir(join(paths.managedMediaRoot, ...segments.slice(0, -1)), { recursive: true });
		await writeFile(join(paths.managedMediaRoot, ...segments), item.body, { flag: 'wx' });
	}
	await initial.releaseLease(staleLease);
	initial.close();

	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: FRAMESCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.deepEqual(host.snapshot().managedMediaReclamation, {
		canonicalFiles: 2,
		catalogRowsRetired: 0,
		complete: true,
		liveStageFiles: 0,
		protectedFiles: 0,
		reclaimedFiles: 0,
		reclaimedStageFiles: 2,
		scannedEntries: 4,
		stageFiles: 2,
	});
	const reclaimed = new DatabaseSync(paths.databasePath, { readOnly: true });
	try {
		assert.equal(reclaimed.prepare('SELECT count(*) AS count FROM managed_media_inventory').get()?.count, 0);
		assert.equal(reclaimed.prepare('SELECT count(*) AS count FROM managed_media_stage_inventory').get()?.count, 0);
	} finally {
		reclaimed.close();
	}
	const prototype = DesktopLibraryProjectStore.prototype;
	const originalRead = prototype.readProjectById;
	prototype.readProjectById = async () => ({
		catalog: { projectRevision, sha256: projectSha256 },
		project: {},
	}) as DesktopLibraryLoadedProject;
	context.after(() => { prototype.readProjectById = originalRead; });
	const retried = await host.publishManagedAudio({
		projectId,
		storageKey: planned[0]!.storageKey,
		byteLength: planned[0]!.body.byteLength,
		sha256: planned[0]!.descriptor.sha256,
		expectedProjectRevision: projectRevision,
		expectedProjectSha256: projectSha256,
		chunks: (async function* () { yield planned[0]!.body; })(),
	});
	assert.deepEqual(retried, planned[0]!.descriptor);
});

function metadata(revision: number) {
	return {
		schemaVersion: 2 as const,
		revision,
		projects: [],
		media: [],
	};
}
