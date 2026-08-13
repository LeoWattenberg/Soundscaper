/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { FramescaperDesktopProjectLibraryV10Catalog } from '../desktop/project-library-v10-catalog.ts';
import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	initializeFramescaperDesktopProjectLibraryV10Database,
} from '../desktop/project-library-v10-database.ts';
import {
	createFramescaperDesktopLibraryProxyMediaBinding,
} from '../desktop/project-library-v10-media-binding.ts';
import {
	FramescaperDesktopProjectLibraryV10PublicationHost,
	type FramescaperDesktopProjectLibraryV10PublicationBodyInput,
	type FramescaperDesktopProjectLibraryV10PublicationCheckpoint,
} from '../desktop/project-library-v10-publication-host.ts';
import { FramescaperDesktopProjectLibraryV10TransferService } from '../desktop/project-library-v10-transfer-service.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_TIMING,
	archiveProject,
} from './helpers/framescaper-v18-archive-fixture.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT_ID = 'framescaper-desktop-publication';
const OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 42,
	instanceId: 'framescaper-v10-publication',
});

test('requires the exact handshake before request, database, or filesystem observation', async (context) => {
	const fixture = await createFixture(context);
	let requestTraps = 0;
	const request = new Proxy({}, {
		getPrototypeOf() { requestTraps += 1; throw new Error('request trap'); },
		ownKeys() { requestTraps += 1; throw new Error('request trap'); },
		getOwnPropertyDescriptor() { requestTraps += 1; throw new Error('request trap'); },
		get() { requestTraps += 1; throw new Error('request trap'); },
	});
	const before = fixture.database.serialize();
	await assert.rejects(fixture.host.publish(request), /handshake.*required/iu);
	assert.equal(requestTraps, 0);
	assert.deepEqual(fixture.database.serialize(), before);
	await assert.rejects(access(fixture.paths.libraryRoot), /ENOENT/u);

	assert.throws(() => fixture.host.acceptHandshake({
		...createFramescaperDesktopProjectLibraryV10Handshake(),
		desktopDatabaseUserVersion: 11,
	}), /handshake/iu);
	assert.equal(fixture.host.handshakeState(), 'refused');
	await assert.rejects(fixture.host.publish(request), /refused/iu);
	assert.equal(requestTraps, 0);
});

test('atomically publishes one exact V18 revision and both managed body roles', async (context) => {
	const fixture = await createFixture(context);
	const project = projectAt(1);
	const bodyInputs = publicationBodies(project);
	const result = await fixture.host.publish({
		lease: fixture.lease,
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: bodyInputs,
	});

	assert.equal(result.metadataRevision, 1);
	assert.equal(result.project.projectId, PROJECT_ID);
	assert.equal(result.project.projectRevision, 1);
	assert.equal(result.bodies.length, 2);
	assert.deepEqual(fixture.phases, ['prepared', 'materialized', 'committed', 'complete']);
	assert.deepEqual(row(fixture.database, 'SELECT revision FROM library_metadata'), { revision: 1 });
	assert.deepEqual(row(fixture.database, `
		SELECT project_id AS projectId, project_revision AS revision, project_sha256 AS sha256
		FROM project_revisions
	`), { projectId: PROJECT_ID, revision: 1, sha256: result.project.sha256 });
	assert.deepEqual(rows(fixture.database, `
		SELECT kind, encoding, state FROM managed_bodies ORDER BY kind
	`), [
		{ kind: 'video-proxy', encoding: 'video-proxy-v1', state: 'published' },
		{ kind: 'video-timing', encoding: 'soundscaper-video-timing-v1', state: 'published' },
	]);
	assert.deepEqual(rows(fixture.database, `
		SELECT state FROM publication_journal
	`), [{ state: 'complete' }]);
	assert.equal((await readFile(join(fixture.paths.libraryRoot, result.project.metadataFile), 'utf8')),
		JSON.stringify(project));
	for (const body of result.bodies) {
		const bytes = await fixture.host.readBodyChunk(body, { offset: 0, length: body.byteLength });
		assert.equal(digest(bytes), body.sha256);
	}

	const transfer = FramescaperDesktopProjectLibraryV10TransferService.create({ host: fixture.host });
	const session = transfer.openSession(transfer.localHandshake);
	assert.deepEqual(await session.readProjectBundle(PROJECT_ID), result);
	assert.equal(await stageFiles(fixture.paths.libraryRoot).then((files) => files.length), 0);
});

test('refuses stale metadata, stale project, and stale writer fences before body consumption', async (context) => {
	let now = 100;
	const fixture = await createFixture(context, { now: () => now });
	const project = projectAt(1);
	for (const request of [
		{
			lease: fixture.lease, expectedMetadataRevision: 1, expectedProject: null,
			project, bodies: publicationBodies(project),
		},
		{
			lease: fixture.lease, expectedMetadataRevision: 0,
			expectedProject: { projectRevision: 0, projectSha256: 'a'.repeat(64) },
			project, bodies: publicationBodies(project),
		},
	]) {
		const streams = countedBodies(request.bodies);
		await assert.rejects(fixture.host.publish({ ...request, bodies: streams.bodies }),
			/metadata.*revision|expected project|absent|compare-and-swap/iu);
		assert.equal(streams.reads, 0);
	}

	now = 5_100;
	const replacement = fixture.catalog.acquireLease({ ttlMs: 5_000 });
	const streams = countedBodies(publicationBodies(project));
	await assert.rejects(fixture.host.publish({
		lease: fixture.lease, expectedMetadataRevision: 0, expectedProject: null,
		project, bodies: streams.bodies,
	}), /lease|fence|no longer owns/iu);
	assert.equal(streams.reads, 0);
	assert.equal(replacement.fencingToken, 2);
	await assert.rejects(access(fixture.paths.libraryRoot), /ENOENT/u);
});

test('rejects incomplete or mismatched proxy/timing declarations before body I/O', async (context) => {
	const fixture = await createFixture(context);
	const project = projectAt(1);
	const complete = publicationBodies(project);
	for (const bodies of [
		[complete[0]!],
		[
			{ ...complete[0]!, descriptor: { ...complete[0]!.descriptor, bindingId: `p${'f'.repeat(64)}` } },
			complete[1]!,
		],
		[
			complete[0]!,
			{ ...complete[1]!, descriptor: { ...complete[1]!.descriptor, mimeType: 'application/octet-stream' } },
		],
	] as const) {
		const streams = countedBodies(bodies as readonly FramescaperDesktopProjectLibraryV10PublicationBodyInput[]);
		await assert.rejects(fixture.host.publish({
			lease: fixture.lease, expectedMetadataRevision: 0, expectedProject: null,
			project, bodies: streams.bodies,
		}), /body|pair|binding|timing|MIME/iu);
		assert.equal(streams.reads, 0);
	}
	await assert.rejects(access(fixture.paths.libraryRoot), /ENOENT/u);
});

test('recovers a prepared two-body publication under the current writer lease', async (context) => {
	let interrupt = true;
	const fixture = await createFixture(context, {
		checkpoint: (phase) => {
			fixture.phases.push(phase);
			if (interrupt && phase === 'prepared') throw new Error('stop after prepared');
		},
	});
	const project = projectAt(1);
	await assert.rejects(fixture.host.publish({
		lease: fixture.lease, expectedMetadataRevision: 0, expectedProject: null,
		project, bodies: publicationBodies(project),
	}), /stop after prepared/u);
	assert.deepEqual(row(fixture.database, 'SELECT revision FROM library_metadata'), { revision: 0 });
	assert.deepEqual(row(fixture.database, 'SELECT state FROM publication_journal'), { state: 'prepared' });
	assert.equal((await stageFiles(fixture.paths.libraryRoot)).length, 3);

	interrupt = false;
	const recovery = await fixture.host.recover({ lease: fixture.lease });
	assert.deepEqual(recovery, {
		outcome: 'committed', projectId: PROJECT_ID, projectRevision: 1, metadataRevision: 1,
	});
	assert.deepEqual(row(fixture.database, 'SELECT revision FROM library_metadata'), { revision: 1 });
	assert.deepEqual(row(fixture.database, 'SELECT state FROM publication_journal'), { state: 'complete' });
	assert.equal((await stageFiles(fixture.paths.libraryRoot)).length, 0);
	assert.ok(await fixture.host.readProjectBundle(PROJECT_ID));
});

test('a pre-journal digest failure cleans private stages and publishes nothing', async (context) => {
	const fixture = await createFixture(context);
	const project = projectAt(1);
	const bodies = publicationBodies(project);
	bodies[0] = { ...bodies[0]!, chunks: chunks(Uint8Array.of(9, 9, 9, 9)) };
	await assert.rejects(fixture.host.publish({
		lease: fixture.lease, expectedMetadataRevision: 0, expectedProject: null,
		project, bodies,
	}), /digest|SHA-256/iu);
	assert.deepEqual(row(fixture.database, 'SELECT revision FROM library_metadata'), { revision: 0 });
	assert.deepEqual(rows(fixture.database, 'SELECT state FROM publication_journal'), []);
	assert.deepEqual(rows(fixture.database, 'SELECT state FROM managed_bodies'), []);
	assert.equal((await stageFiles(fixture.paths.libraryRoot)).length, 0);
});

test('keeps publication unreachable from V9 and maintained Electron composition', async () => {
	for (const legacy of [
		'desktop/main.mjs', 'desktop/preload.mjs', 'desktop/project-library-ipc.js',
		'desktop/project-library-host.ts', 'desktop/project-library-database.ts',
	]) assert.doesNotMatch(
		await readFile(resolve(ROOT, legacy), 'utf8'),
		/project-library-v10-publication/iu,
		legacy,
	);
});

interface FixtureOptions {
	readonly checkpoint?: (phase: FramescaperDesktopProjectLibraryV10PublicationCheckpoint) => void;
	readonly now?: () => number;
}

async function createFixture(context: TestContext, options: FixtureOptions = {}) {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-v10-publication-'));
	context.after(() => rm(appDataPath, { force: true, recursive: true }));
	const database = new DatabaseSync(':memory:');
	context.after(() => database.close());
	initializeFramescaperDesktopProjectLibraryV10Database(database);
	const catalog = FramescaperDesktopProjectLibraryV10Catalog.create({
		database, owner: OWNER, now: options.now ?? (() => 100), randomId: ids('a', 'b', 'c'),
	});
	catalog.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	const lease = catalog.acquireLease({ ttlMs: 5_000 });
	const phases: FramescaperDesktopProjectLibraryV10PublicationCheckpoint[] = [];
	const host = FramescaperDesktopProjectLibraryV10PublicationHost.create({
		database, appDataPath, now: options.now ?? (() => 100), randomId: ids('d', 'e', 'f'),
		checkpoint: options.checkpoint ?? ((phase) => phases.push(phase)),
	});
	host.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	return { database, catalog, host, lease, phases, paths: host.paths };
}

function projectAt(revision: number): FramescaperProjectV18 {
	return archiveProject({ id: PROJECT_ID, revision, title: 'Framescaper desktop publication' });
}

function publicationBodies(
	project: FramescaperProjectV18,
): FramescaperDesktopProjectLibraryV10PublicationBodyInput[] {
	const document = JSON.stringify(project);
	const projectSha256 = digest(new TextEncoder().encode(document));
	const source = project.sources.find((candidate) => candidate.kind === 'video');
	assert.ok(source?.kind === 'video' && source.proxyAttachment);
	const attachment = source.proxyAttachment;
	const binding = createFramescaperDesktopLibraryProxyMediaBinding(
		String(project.id), attachment.storageKey, Number(project.revision), projectSha256,
	);
	return [{
		descriptor: {
			kind: 'video-proxy', encoding: 'video-proxy-v1', bindingId: binding.id,
			sourceId: attachment.storageKey, storageKey: attachment.storageKey,
			mimeType: attachment.mimeType, byteLength: attachment.byteLength, sha256: attachment.sha256,
		},
		chunks: chunks(ARCHIVE_PROXY_BYTES),
	}, {
		descriptor: {
			kind: 'video-timing', encoding: 'soundscaper-video-timing-v1',
			sourceId: attachment.timingAsset.storageKey, storageKey: attachment.timingAsset.storageKey,
			mimeType: 'application/vnd.soundscaper.video-timing',
			byteLength: attachment.timingAsset.byteLength, sha256: attachment.timingAsset.sha256,
		},
		chunks: chunks(ARCHIVE_TIMING.bytes),
	}];
}

function countedBodies(inputs: readonly FramescaperDesktopProjectLibraryV10PublicationBodyInput[]) {
	let reads = 0;
	return {
		get reads() { return reads; },
		bodies: inputs.map(({ descriptor, chunks: bodyChunks }) => ({
			descriptor,
			chunks: (async function* () { reads += 1; yield* bodyChunks; })(),
		})),
	};
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
	yield bytes.slice(0, midpoint);
	if (midpoint < bytes.byteLength) yield bytes.slice(midpoint);
}

function ids(...values: string[]) {
	let index = 0;
	return () => (values[index++] ?? 'f').repeat(48);
}

function row(database: DatabaseSync, sql: string): Record<string, unknown> | undefined {
	const value = database.prepare(sql).get();
	return value ? { ...value } : undefined;
}

function rows(database: DatabaseSync, sql: string): Record<string, unknown>[] {
	return database.prepare(sql).all().map((value) => ({ ...value }));
}

async function stageFiles(libraryRoot: string): Promise<string[]> {
	try { return await readdir(join(libraryRoot, 'stage')); }
	catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
		throw error;
	}
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
