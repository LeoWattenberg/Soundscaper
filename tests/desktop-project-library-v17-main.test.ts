/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

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
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';

const NOW = '2026-08-23T12:00:00.000Z';

test('Framescaper desktop V17 owns exact V20/SQLite 19/v17 identity beside immutable V12', () => {
	const root = join(tmpdir(), 'framescaper-v17-contract');
	const handshake = createFramescaperDesktopProjectLibraryV17Handshake();
	assert.deepEqual(handshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 20,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v20',
		desktopLibrarySchemaVersion: 17,
		desktopDatabaseUserVersion: 19,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v17'],
	});
	assert.notEqual(
		createFramescaperDesktopProjectLibraryV17Paths(root).libraryRoot,
		createFramescaperDesktopProjectLibraryV12Paths(root).libraryRoot,
	);
});

test('V17 copy-forwards V12 once without opening the source for writes', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v17-import-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const v12Paths = createFramescaperDesktopProjectLibraryV12Paths(appDataPath);
	const v12 = await FramescaperDesktopProjectLibraryV12Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1201, instanceId: 'v12-source' },
		handshake: createFramescaperDesktopProjectLibraryV12Handshake(),
	});
	const sourceSession = v12.openSession(v12.localHandshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'copy-forward-project', title: 'Copy forward project', revision: 0, now: NOW,
	});
	await sourceSession.beginPublication({
		publicationId: 'ab'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	const sourceBundle = await sourceSession.finishPublication({ publicationId: 'ab'.repeat(24) });
	await sourceSession.close();
	await v12.close();
	const sourceBytes = await readFile(v12Paths.databasePath);
	const sourceTimestamp = (await stat(v12Paths.databasePath)).mtimeMs;

	const first = await startV17(appDataPath, 1701, 'v17-first');
	const imported = first.openSession(first.localHandshake);
	assert.deepEqual(await imported.readProjectBundle(project.id), sourceBundle);
	await imported.close();
	const firstWriter = first.snapshot().writer;
	assert.equal(firstWriter.fencingToken, 1);
	assert.equal(firstWriter.tookOverStaleLease, false);
	await first.close();

	const second = await startV17(appDataPath, 1702, 'v17-second');
	assert.equal(second.snapshot().writer.fencingToken, 2);
	const secondSession = second.openSession(second.localHandshake);
	assert.equal((await secondSession.readProjectBundle(project.id)) !== null, true);
	await secondSession.close();
	await second.close();
	assert.deepEqual(await readFile(v12Paths.databasePath), sourceBytes);
	assert.equal((await stat(v12Paths.databasePath)).mtimeMs, sourceTimestamp);

	const v17Paths = createFramescaperDesktopProjectLibraryV17Paths(appDataPath);
	const database = new DatabaseSync(v17Paths.databasePath, { readOnly: true });
	assert.equal(Number(database.prepare('PRAGMA user_version').get()?.user_version), 19);
	const importState = database.prepare(
		'SELECT state, source_project_count AS sourceProjectCount FROM v12_import WHERE singleton = 1',
	).get();
	assert.equal(importState?.state, 'complete');
	assert.equal(importState?.sourceProjectCount, 1);
	database.close();
});

test('V17 copy-forward resumes after an injected post-row interruption without duplication', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v17-resume-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const v12 = await FramescaperDesktopProjectLibraryV12Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1210, instanceId: 'v12-resume-source' },
		handshake: createFramescaperDesktopProjectLibraryV12Handshake(),
	});
	const session = v12.openSession(v12.localHandshake);
	for (const [index, id] of ['resume-a', 'resume-b'].entries()) {
		const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
			id, title: id, revision: 0, now: NOW,
		});
		await session.beginPublication({
			publicationId: (index === 0 ? 'ac' : 'ad').repeat(24),
			expectedMetadataRevision: index, expectedProject: null, project, bodies: [],
		});
		await session.finishPublication({ publicationId: (index === 0 ? 'ac' : 'ad').repeat(24) });
	}
	await session.close();
	await v12.close();

	await assert.rejects(FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1710, instanceId: 'v17-interrupted' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification: {
			leaseTtlMs: 30_000, renewIntervalMs: 10_000, checkpoint: null,
			importCheckpoint: (completedProjects: number) => {
				if (completedProjects === 1) throw new Error('injected import interruption');
			},
		},
	}), /injected import interruption/u);

	const resumed = await startV17(appDataPath, 1711, 'v17-resumed');
	const reopened = resumed.openSession(resumed.localHandshake);
	assert.equal((await reopened.listProjects() as { projects: unknown[] }).projects.length, 2);
	await reopened.close();
	await resumed.close();
});

test('V17 renews one writer lease, refuses a concurrent admission, and transfers monotonically', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v17-lease-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const qualification = {
		leaseTtlMs: 100, renewIntervalMs: 20, checkpoint: null, importCheckpoint: null,
	};
	const first = await FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1720, instanceId: 'lease-first' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	});
	await new Promise((resolve) => setTimeout(resolve, 240));
	const session = first.openSession(first.localHandshake);
	assert.equal((await session.listProjects() as { projects: unknown[] }).projects.length, 0);
	await assert.rejects(FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1721, instanceId: 'lease-refused' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	}), /V17 writer lease is busy/u);
	await session.close();
	await first.close();
	const transferred = await FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1722, instanceId: 'lease-transferred' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	});
	assert.equal(transferred.snapshot().writer.fencingToken, 2);
	await transferred.close();
});

test('V17 stale takeover persistently fences the former writer before publication', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v17-fence-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	let lost: unknown = null;
	const qualification = {
		leaseTtlMs: 5_000, renewIntervalMs: 4_000, checkpoint: null, importCheckpoint: null,
	};
	const first = await FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1730, instanceId: 'stale-first' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: (error: unknown) => { lost = error; },
		qualification,
	});
	const firstSession = first.openSession(first.localHandshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'fenced-project', title: 'Fenced project', revision: 0, now: NOW,
	});
	await firstSession.beginPublication({
		publicationId: 'ae'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	const paths = createFramescaperDesktopProjectLibraryV17Paths(appDataPath);
	const database = new DatabaseSync(paths.databasePath);
	database.prepare('UPDATE library_lease SET expires_at_ms = ? WHERE singleton = 1').run(Date.now() - 1);
	database.close();
	const takeover = await FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1731, instanceId: 'stale-takeover' },
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: () => undefined,
		qualification,
	});
	assert.equal(takeover.snapshot().writer.fencingToken, 2);
	assert.equal(takeover.snapshot().writer.tookOverStaleLease, true);
	await assert.rejects(
		firstSession.finishPublication({ publicationId: 'ae'.repeat(24) }),
		/no longer owns its fence/u,
	);
	assert(lost instanceof Error);
	assert.equal(first.snapshot().fenced, true);
	await first.close();
	await takeover.close();
});

test('V17 recovers committed and materialized publication journals deterministically', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v17-journal-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const main = await startV17(appDataPath, 1740, 'journal-source');
	const session = main.openSession(main.localHandshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'journal-project', title: 'Journal project', revision: 0, now: NOW,
	});
	await session.beginPublication({
		publicationId: 'af'.repeat(24), expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [],
	});
	await session.finishPublication({ publicationId: 'af'.repeat(24) });
	await session.close();
	await main.close();

	const paths = createFramescaperDesktopProjectLibraryV17Paths(appDataPath);
	const database = new DatabaseSync(paths.databasePath);
	const row = database.prepare(`
		SELECT project_revision AS projectRevision, sha256, document_file AS documentFile
		FROM projects WHERE project_id = ?
	`).get(project.id)!;
	database.prepare(`
		INSERT INTO publication_journal (
			publication_id, state, project_id, project_revision, project_sha256,
			document_file, expected_metadata_revision, result_json,
			lease_id, fencing_token, created_at_ms, updated_at_ms
		) VALUES (?, 'committed', ?, ?, ?, ?, 0, '{}', 'crashed', 1, ?, ?)
	`).run('b0'.repeat(24), project.id, row.projectRevision, row.sha256, row.documentFile, Date.now(), Date.now());
	database.close();
	const committed = await startV17(appDataPath, 1741, 'journal-committed');
	assert.deepEqual(committed.snapshot().writer.recovery, { outcome: 'committed', publishedRevision: 0 });
	await committed.close();

	const orphanRelative = `orphan/${'b1'.repeat(32)}.json`;
	const orphanPath = join(paths.projectsRoot, orphanRelative);
	await mkdir(join(orphanPath, '..'), { recursive: true });
	await writeFile(orphanPath, '{}');
	const reopened = new DatabaseSync(paths.databasePath);
	reopened.prepare(`
		INSERT INTO publication_journal (
			publication_id, state, project_id, project_revision, project_sha256,
			document_file, expected_metadata_revision, result_json,
			lease_id, fencing_token, created_at_ms, updated_at_ms
		) VALUES (?, 'materialized', 'orphan-project', 0, ?, ?, 1, NULL, 'crashed', 2, ?, ?)
	`).run('b2'.repeat(24), 'b3'.repeat(32), orphanRelative, Date.now(), Date.now());
	reopened.close();
	const discarded = await startV17(appDataPath, 1742, 'journal-discarded');
	assert.deepEqual(discarded.snapshot().writer.recovery, { outcome: 'discarded', publishedRevision: null });
	await assert.rejects(access(orphanPath), /ENOENT/u);
	await discarded.close();
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
