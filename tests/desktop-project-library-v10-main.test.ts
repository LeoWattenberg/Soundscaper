/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	createFramescaperDesktopProjectLibraryV10Paths,
} from '../desktop/project-library-v10-contract.ts';
import {
	initializeFramescaperDesktopProjectLibraryV10Database,
} from '../desktop/project-library-v10-database.ts';
import {
	FramescaperDesktopProjectLibraryV10Main,
} from '../desktop/project-library-v10-main.ts';
import {
	FramescaperDesktopProjectLibraryV10PublicationHost,
} from '../desktop/project-library-v10-publication-host.ts';
import {
	uploadV10MainPublication,
	v10MainPublication,
	V10_MAIN_PROJECT_ID,
} from './helpers/desktop-project-library-v10-main-fixture.ts';

const OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 42,
	instanceId: 'framescaper-v10-main-owner',
});

test('authenticates the exact local product and handshake before filesystem observation', async (context) => {
	const root = await temporaryRoot(context);
	const appDataPath = join(root, 'unobserved-app-data');
	for (const value of [
		{
			appDataPath,
			owner: { ...OWNER, product: 'soundscaper' },
			handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
		},
		{
			appDataPath,
			owner: OWNER,
			handshake: {
				...createFramescaperDesktopProjectLibraryV10Handshake(),
				desktopDatabaseUserVersion: 11,
			},
		},
		{
			appDataPath,
			owner: OWNER,
			handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
			lease: { fencingToken: 1 },
		},
	] as const) await assert.rejects(
		FramescaperDesktopProjectLibraryV10Main.start(value),
		/owner|handshake|unsupported field/iu,
	);
	await assert.rejects(access(appDataPath), /ENOENT/u);
});

test('owns the lease, publishes through one exact session, and closes the database gracefully', async (context) => {
	const appDataPath = await temporaryRoot(context);
	const main = await startMain(appDataPath);
	context.after(() => main.close());
	assert.deepEqual(main.snapshot(), {
		closed: false,
		fenced: false,
		owner: OWNER,
		activeSessions: 0,
		activePublication: false,
	});
	const session = main.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
	const result = await uploadV10MainPublication(session);
	assert.equal(result.project.projectId, V10_MAIN_PROJECT_ID);
	assert.deepEqual(await session.readProjectBundle(V10_MAIN_PROJECT_ID), result);
	assert.ok(result.bodies.every((body) => !('path' in body) && !('lease' in body)));
	assert.equal(main.snapshot().activeSessions, 1);

	await session.close();
	await main.close();
	await main.close();
	assert.equal(main.snapshot().closed, true);
	const database = openDatabase(appDataPath);
	try {
		assert.deepEqual({ ...database.prepare(
			'SELECT active, owner_product AS owner FROM library_lease WHERE singleton = 1',
		).get() }, { active: 0, owner: 'framescaper' });
		assert.deepEqual(database.prepare(
			'SELECT project_revision AS revision FROM project_revisions',
		).all().map((row) => ({ ...row })), [{ revision: 1 }]);
	} finally { database.close(); }
});

test('startup takes a released fence and rolls a prepared body journal forward', async (context) => {
	const appDataPath = await temporaryRoot(context);
	await seedPreparedPublication(appDataPath);
	const main = await startMain(appDataPath);
	context.after(() => main.close());
	const session = main.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
	assert.ok(await session.readProjectBundle(V10_MAIN_PROJECT_ID));
	const database = openDatabase(appDataPath);
	try {
		assert.deepEqual(database.prepare(
			'SELECT state FROM publication_journal',
		).all().map((row) => ({ ...row })), [{ state: 'complete' }]);
		assert.deepEqual({ ...database.prepare(
			'SELECT fencing_token AS fence FROM library_lease',
		).get() }, { fence: 2 });
	} finally { database.close(); }
});

test('close aborts and drains a body-starved publication before releasing its lease', async (context) => {
	const appDataPath = await temporaryRoot(context);
	const main = await startMain(appDataPath);
	const session = main.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
	const admission = await session.beginPublication(v10MainPublication().request);
	await assert.rejects(
		session.finishPublication({ publicationId: admission.publicationId }),
		/incomplete/iu,
	);
	assert.equal(main.snapshot().activePublication, true);
	await main.close();
	await assert.rejects(session.finishPublication({ publicationId: admission.publicationId }), /closed|abort/iu);
	const paths = createFramescaperDesktopProjectLibraryV10Paths(appDataPath);
	assert.deepEqual(await readdir(join(paths.libraryRoot, 'stage')), []);
	const database = openDatabase(appDataPath);
	try {
		assert.deepEqual({ ...database.prepare(
			'SELECT active FROM library_lease WHERE singleton = 1',
		).get() }, { active: 0 });
		assert.deepEqual(database.prepare('SELECT state FROM publication_journal').all(), []);
	} finally { database.close(); }
});

test('a replaced database fence rejects an in-flight renderer publication without rows', async (context) => {
	const appDataPath = await temporaryRoot(context);
	const main = await startMain(appDataPath);
	context.after(() => main.close());
	const session = main.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
	const fixture = v10MainPublication();
	const admission = await session.beginPublication(fixture.request);
	const database = openDatabase(appDataPath);
	try {
		database.prepare(`
			UPDATE library_lease SET lease_id = ?, fencing_token = fencing_token + 1
			WHERE singleton = 1
		`).run('f'.repeat(48));
	} finally { database.close(); }
	for (const [bodyIndex, bytes] of fixture.bodies.entries()) {
		await session.writePublicationChunk({
			publicationId: admission.publicationId, bodyIndex, offset: 0, bytes,
		});
	}
	await assert.rejects(
		session.finishPublication({ publicationId: admission.publicationId }),
		/lease|fence|owns/iu,
	);
	const verify = openDatabase(appDataPath);
	try {
		assert.deepEqual(verify.prepare('SELECT project_id FROM project_revisions').all(), []);
		assert.deepEqual(verify.prepare('SELECT state FROM publication_journal').all(), []);
	} finally { verify.close(); }
});

async function startMain(appDataPath: string) {
	return FramescaperDesktopProjectLibraryV10Main.start({
		appDataPath,
		owner: OWNER,
		handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
	});
}

async function seedPreparedPublication(appDataPath: string): Promise<void> {
	const paths = createFramescaperDesktopProjectLibraryV10Paths(appDataPath);
	await mkdir(paths.libraryRoot, { recursive: true });
	const database = new DatabaseSync(paths.databasePath);
	initializeFramescaperDesktopProjectLibraryV10Database(database);
	const lease = leaseInDatabase(database, 1);
	const host = FramescaperDesktopProjectLibraryV10PublicationHost.create({
		database,
		appDataPath,
		now: () => 100,
		randomId: ids('a', 'b'),
		checkpoint: (phase: string) => { if (phase === 'prepared') throw new Error('prepared crash'); },
	});
	host.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	const fixture = v10MainPublication();
	await assert.rejects(host.publish({
		...fixture.request,
		lease,
		bodies: fixture.request.bodies.map((descriptor, index) => ({
			descriptor,
			chunks: (async function* () { yield fixture.bodies[index]!; })(),
		})),
	}), /prepared crash/u);
	database.prepare('UPDATE library_lease SET active = 0 WHERE singleton = 1').run();
	database.close();
}

function leaseInDatabase(database: DatabaseSync, fencingToken: number) {
	const lease = {
		leaseId: 'c'.repeat(48), fencingToken, owner: OWNER,
		acquiredAtMs: 100, expiresAtMs: Date.now() + 60_000, tookOverStaleLease: false,
	};
	database.prepare(`
		UPDATE library_lease SET active = 1, lease_id = ?, fencing_token = ?,
			owner_product = 'framescaper', owner_process_id = ?, owner_instance_id = ?,
			acquired_at_ms = ?, expires_at_ms = ?, took_over = 0 WHERE singleton = 1
	`).run(
		lease.leaseId, lease.fencingToken, OWNER.processId, OWNER.instanceId,
		lease.acquiredAtMs, lease.expiresAtMs,
	);
	return lease;
}

function openDatabase(appDataPath: string): DatabaseSync {
	return new DatabaseSync(createFramescaperDesktopProjectLibraryV10Paths(appDataPath).databasePath);
}

async function temporaryRoot(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-main-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	return root;
}

function ids(...values: string[]) {
	let index = 0;
	return () => (values[index++] ?? 'f').repeat(48);
}
