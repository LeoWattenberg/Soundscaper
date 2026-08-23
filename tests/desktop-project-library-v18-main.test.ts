/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createDesktopProjectLibraryLeaseMatrixDocument } from '../scripts/lib/desktop-project-library-lease-matrix.mjs';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	createFramescaperDesktopProjectLibraryV12Handshake,
	createFramescaperDesktopProjectLibraryV12Paths,
} from '../desktop/project-library-v12-contract.ts';
import { FramescaperDesktopProjectLibraryV12Main } from '../desktop/project-library-v12-main.ts';
import {
	createFramescaperDesktopProjectLibraryV17Handshake,
	createFramescaperDesktopProjectLibraryV17Paths,
} from '../desktop/project-library-v17-contract.ts';
import { FramescaperDesktopProjectLibraryV17Main } from '../desktop/project-library-v17-main.ts';
import {
	createFramescaperDesktopProjectLibraryV18Handshake,
	createFramescaperDesktopProjectLibraryV18Paths,
} from '../desktop/project-library-v18-contract.ts';
import { FramescaperDesktopProjectLibraryV18Main } from '../desktop/project-library-v18-main.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectV27,
	reimportFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';

const NOW = '2026-08-23T12:00:00.000Z';

test('V18 packaged lease fixture is an exact source-free V27 document', () => {
	const document = createDesktopProjectLibraryLeaseMatrixDocument(
		'framescaper-v18-lease-fixture', 3, 'V18 lease fixture', 'framescaper',
	);
	const project = JSON.parse(document) as Record<string, unknown>;
	assert.equal(project.schemaVersion, 27);
	assert.equal(project.revision, 3);
	assert.deepEqual(project.sources, []);
	assert.deepEqual(project.clips, []);
	assert.deepEqual(project.tracks, []);
	assert.deepEqual(
		reimportFramescaperProjectV27(
			FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
			createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
				id: 'framescaper-v18-lease-fixture', title: 'V18 lease fixture', revision: 3, now: NOW,
			}),
		),
		project,
	);
});

test('Framescaper desktop V18 owns exact V27/SQLite 20/v18 identity beside immutable V17', () => {
	const root = join(tmpdir(), 'framescaper-v18-contract');
	assert.deepEqual(createFramescaperDesktopProjectLibraryV18Handshake(), {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 27,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v27',
		desktopLibrarySchemaVersion: 18,
		desktopDatabaseUserVersion: 20,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v18'],
	});
	assert.notEqual(
		createFramescaperDesktopProjectLibraryV18Paths(root).libraryRoot,
		createFramescaperDesktopProjectLibraryV17Paths(root).libraryRoot,
	);
});

test('V18 main persists only exact V27 documents in its isolated SQLite 20 catalog', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-current-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const main = await startV18(appDataPath, 1801, 'v18-current');
	const session = main.openSession(main.localHandshake);
	const project = createFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-current-project', title: 'V18 current project', revision: 0, now: NOW,
	});
	await session.beginPublication({
		publicationId: 'c1'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	const published = await session.finishPublication({ publicationId: 'c1'.repeat(24) });
	assert.equal((published as { project: { projectSchemaVersion: number } }).project.projectSchemaVersion, 27);
	assert.equal((await session.readProjectBundle(String(project.id)) as { document: string }).document, JSON.stringify(project));
	await session.close();
	await main.close();

	const paths = createFramescaperDesktopProjectLibraryV18Paths(appDataPath);
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	assert.equal(Number(database.prepare('PRAGMA user_version').get()?.user_version), 20);
	const identity = database.prepare(`
		SELECT schema_version AS libraryVersion, project_schema_version AS projectVersion
		FROM library_identity WHERE singleton = 1
	`).get();
	assert.equal(identity?.libraryVersion, 18);
	assert.equal(identity?.projectVersion, 27);
	database.close();
});

test('V18 renderer revocation invalidates an in-flight prepared publication before draining', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-revoke-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	let resolvePrepared: (() => void) | undefined;
	const prepared = new Promise<void>((resolve) => { resolvePrepared = resolve; });
	const main = await FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1804, instanceId: 'v18-revoke' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification: {
			leaseTtlMs: 30_000, renewIntervalMs: 10_000, importCheckpoint: null,
			checkpoint: (phase: 'prepared' | 'materialized' | 'committed' | 'complete') => {
				if (phase === 'prepared') resolvePrepared?.();
			},
		},
	});
	const session = main.openSession(main.localHandshake);
	const project = createFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		id: 'v18-revoked-project', title: 'Revoked project', revision: 0, now: NOW,
	});
	await session.beginPublication({
		publicationId: 'c2'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	const finishing = session.finishPublication({ publicationId: 'c2'.repeat(24) });
	await prepared;
	const revoked = session.revoke();
	await assert.rejects(finishing, /publication ownership changed/u);
	await revoked;
	const verification = main.openSession(main.localHandshake);
	assert.equal(await verification.readProjectBundle(String(project.id)), null);
	await verification.close();
	await main.close();
});

test('V18 safely cascades an immutable V12-only installation through settled V17', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-v12-cascade-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const v12Paths = createFramescaperDesktopProjectLibraryV12Paths(appDataPath);
	const source = await FramescaperDesktopProjectLibraryV12Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1201, instanceId: 'v12-v18-cascade' },
		handshake: createFramescaperDesktopProjectLibraryV12Handshake(),
	});
	const sourceSession = source.openSession(source.localHandshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'v12-only-lineage', title: 'V12 only lineage', revision: 0, now: NOW,
	});
	await sourceSession.beginPublication({
		publicationId: 'bf'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	await sourceSession.finishPublication({ publicationId: 'bf'.repeat(24) });
	await sourceSession.close();
	await source.close();
	const sourceBytes = await readFile(v12Paths.databasePath);
	const sourceTimestamp = (await stat(v12Paths.databasePath)).mtimeMs;

	const selected = await startV18(appDataPath, 1804, 'v18-v12-cascade');
	const session = selected.openSession(selected.localHandshake);
	const imported = await session.readProjectBundle(project.id) as { document: string } | null;
	assert.deepEqual(
		JSON.parse(imported?.document ?? 'null'),
		reimportFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, project),
	);
	await session.close();
	await selected.close();

	assert.deepEqual(await readFile(v12Paths.databasePath), sourceBytes);
	assert.equal((await stat(v12Paths.databasePath)).mtimeMs, sourceTimestamp);
	const v17 = new DatabaseSync(
		createFramescaperDesktopProjectLibraryV17Paths(appDataPath).databasePath,
		{ readOnly: true },
	);
	assert.equal(v17.prepare('SELECT state FROM v12_import WHERE singleton = 1').get()?.state, 'complete');
	assert.equal(v17.prepare('SELECT active FROM library_lease WHERE singleton = 1').get()?.active, 0);
	v17.close();
});

test('V18 resumes an interrupted V12 to V17 cascade before selecting V27', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-v12-resume-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = await FramescaperDesktopProjectLibraryV12Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1211, instanceId: 'v12-v18-resume' },
		handshake: createFramescaperDesktopProjectLibraryV12Handshake(),
	});
	const sourceSession = source.openSession(source.localHandshake);
	for (const [index, id] of ['v12-resume-a', 'v12-resume-b'].entries()) {
		const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
			id, title: id, revision: 0, now: NOW,
		});
		const publicationId = (index === 0 ? 'c5' : 'c6').repeat(24);
		await sourceSession.beginPublication({
			publicationId, expectedMetadataRevision: index, expectedProject: null, project, bodies: [],
		});
		await sourceSession.finishPublication({ publicationId });
	}
	await sourceSession.close();
	await source.close();

	await assert.rejects(FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1711, instanceId: 'v17-v18-interrupt' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification: {
			leaseTtlMs: 30_000, renewIntervalMs: 10_000, checkpoint: null,
			importCheckpoint: (completedProjects: number) => {
				if (completedProjects === 1) throw new Error('injected direct-upgrade interruption');
			},
		},
	}), /injected direct-upgrade interruption/u);

	const selected = await startV18(appDataPath, 1813, 'v18-v12-resumed');
	const session = selected.openSession(selected.localHandshake);
	const catalog = await session.listProjects() as { projects: readonly unknown[] };
	assert.equal(catalog.projects.length, 2);
	await session.close();
	await selected.close();
});

test('V18 reimports immutable V17 documents and copy-forwards managed bodies exactly once', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-import-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = await startV17(appDataPath, 1701, 'v17-source');
	const sourceSession = source.openSession(source.localHandshake);
	const bodyBytes = Uint8Array.of(1, 3, 5, 7, 9, 11);
	const bodySha256 = createHash('sha256').update(bodyBytes).digest('hex');
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'v17-lineage-project', title: 'V17 lineage', revision: 0, now: NOW,
		sources: [createVideoSource({
			id: 'legacy-body', name: 'Legacy.mov', storageKey: 'legacy-body', mimeType: 'video/quicktime',
			contentSha256: bodySha256, sampleFrameCount: 4_000, sampleRate: 48_000,
			sourceFrameCount: 2, frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		})],
	});
	const publicationId = 'c2'.repeat(24);
	await sourceSession.beginPublication({
		publicationId, expectedMetadataRevision: 0, expectedProject: null, project,
		bodies: [{
			kind: 'video-original', encoding: 'framescaper-video-original-v1',
			sourceId: 'legacy-body', storageKey: 'legacy-body', mimeType: 'video/quicktime',
			byteLength: bodyBytes.byteLength, sha256: bodySha256,
		}],
	});
	await sourceSession.writePublicationChunk({
		publicationId, bodyIndex: 0, offset: 0, bytes: bodyBytes,
	});
	await sourceSession.finishPublication({ publicationId });
	await sourceSession.close();
	await source.close();

	const sourcePaths = createFramescaperDesktopProjectLibraryV17Paths(appDataPath);
	const sourceDatabase = await readFile(sourcePaths.databasePath);
	const sourceTimestamp = (await stat(sourcePaths.databasePath)).mtimeMs;
	const first = await startV18(appDataPath, 1802, 'v18-import');
	const importedSession = first.openSession(first.localHandshake);
	const imported = await importedSession.readProjectBundle(project.id) as {
		document: string; bodies: readonly unknown[];
	};
	assert.deepEqual(
		JSON.parse(imported.document),
		reimportFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, project),
	);
	assert.deepEqual(await first.readNativeBody(imported.bodies[0]), bodyBytes);
	await importedSession.close();
	await first.close();

	const second = await startV18(appDataPath, 1803, 'v18-reopen');
	assert.equal(second.snapshot().writer.fencingToken, 2);
	await second.close();
	assert.deepEqual(await readFile(sourcePaths.databasePath), sourceDatabase);
	assert.equal((await stat(sourcePaths.databasePath)).mtimeMs, sourceTimestamp);

	const destination = new DatabaseSync(
		createFramescaperDesktopProjectLibraryV18Paths(appDataPath).databasePath,
		{ readOnly: true },
	);
	const progress = destination.prepare(`
		SELECT state, source_project_count AS count, next_project_index AS cursor
		FROM v17_import WHERE singleton = 1
	`).get();
	assert.equal(progress?.state, 'complete');
	assert.equal(progress?.count, 1);
	assert.equal(progress?.cursor, 1);
	destination.close();
});

test('a completed copy-forward never reopens the retired V17 source', async (context) => {
	// After the migration completes, whatever the old build later does to its
	// own database — a crash leaving its lease active, a stray save changing
	// the catalog digest — must not block the migrated library from opening.
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-retired-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = await startV17(appDataPath, 1901, 'v17-source');
	const session = source.openSession(source.localHandshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'retired-project', title: 'Retired', revision: 0, now: NOW,
	});
	await session.beginPublication({
		publicationId: 'd4'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	await session.finishPublication({ publicationId: 'd4'.repeat(24) });
	await session.close();
	await source.close();

	const migrated = await startV18(appDataPath, 1902, 'v18-migrated');
	await migrated.close();

	const sourcePaths = createFramescaperDesktopProjectLibraryV17Paths(appDataPath);
	const retired = new DatabaseSync(sourcePaths.databasePath);
	retired.prepare('UPDATE library_lease SET active = 1, lease_id = ?, expires_at_ms = ? WHERE singleton = 1')
		.run('ff'.repeat(24), 4_102_444_800_000);
	retired.prepare("UPDATE projects SET title = 'Edited in old build'").run();
	retired.close();

	const reopened = await startV18(appDataPath, 1903, 'v18-reopened');
	const reopenedSession = reopened.openSession(reopened.localHandshake);
	const bundle = await reopenedSession.readProjectBundle('retired-project') as { document: string };
	assert.equal(
		(JSON.parse(bundle.document) as { title?: unknown }).title, 'Retired',
		'the migrated document is served untouched by the old build edit',
	);
	await reopenedSession.close();
	await reopened.close();
});

test('V18 copy-forward resumes after a committed-row interruption without duplication', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-resume-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = await startV17(appDataPath, 1710, 'v17-resume-source');
	const session = source.openSession(source.localHandshake);
	for (const [index, id] of ['v18-resume-a', 'v18-resume-b'].entries()) {
		const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
			id, title: id, revision: 0, now: NOW,
		});
		const publicationId = (index === 0 ? 'c3' : 'c4').repeat(24);
		await session.beginPublication({
			publicationId, expectedMetadataRevision: index,
			expectedProject: null, project, bodies: [],
		});
		await session.finishPublication({ publicationId });
	}
	await session.close();
	await source.close();

	await assert.rejects(FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1810, instanceId: 'v18-interrupted' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification: {
			leaseTtlMs: 30_000, renewIntervalMs: 10_000, checkpoint: null,
			importCheckpoint: (completedProjects: number) => {
				if (completedProjects === 1) throw new Error('injected V18 import interruption');
			},
		},
	}), /injected V18 import interruption/u);
	const sourceDatabase = createFramescaperDesktopProjectLibraryV17Paths(appDataPath).databasePath;
	const unavailableSource = `${sourceDatabase}.temporarily-unavailable`;
	await rename(sourceDatabase, unavailableSource);
	await assert.rejects(startV18(appDataPath, 1811, 'v18-missing-resume-source'),
		/V17 source is unavailable after durable import admission/u);
	await rename(unavailableSource, sourceDatabase);

	const resumed = await startV18(appDataPath, 1812, 'v18-resumed');
	const reopened = resumed.openSession(resumed.localHandshake);
	const catalog = await reopened.listProjects() as { projects: readonly unknown[] };
	assert.equal(catalog.projects.length, 2);
	await reopened.close();
	await resumed.close();
});

test('V18 retains renewable single-writer admission and monotonic lease transfer', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-lease-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const qualification = {
		leaseTtlMs: 100, renewIntervalMs: 20, checkpoint: null, importCheckpoint: null,
	};
	const first = await FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1820, instanceId: 'v18-lease-first' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	});
	await new Promise((resolve) => setTimeout(resolve, 240));
	await assert.rejects(FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1821, instanceId: 'v18-lease-refused' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	}), /V18 writer lease is busy/u);
	await first.close();
	const transferred = await FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1822, instanceId: 'v18-lease-next' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	});
	assert.equal(transferred.snapshot().writer.fencingToken, 2);
	await transferred.close();
});

async function startV17(appDataPath: string, processId: number, instanceId: string) {
	return FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId, instanceId },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification: null,
	});
}

async function startV18(appDataPath: string, processId: number, instanceId: string) {
	return FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId, instanceId },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification: null,
	});
}
