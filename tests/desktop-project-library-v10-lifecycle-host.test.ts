/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	FramescaperDesktopProjectLibraryV10Catalog,
	type FramescaperDesktopProjectLibraryV10Checkpoint,
} from '../desktop/project-library-v10-catalog.ts';
import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	initializeFramescaperDesktopProjectLibraryV10Database,
} from '../desktop/project-library-v10-database.ts';
import {
	FramescaperDesktopProjectLibraryV10LifecycleHost,
} from '../desktop/project-library-v10-lifecycle-host.ts';
import {
	createFramescaperDesktopLibraryProxyMediaBinding,
} from '../desktop/project-library-v10-media-binding.ts';
import {
	FramescaperDesktopProjectLibraryV10PublicationHost,
	type FramescaperDesktopProjectLibraryV10PublicationBodyInput,
	type FramescaperDesktopProjectLibraryV10PublicationCheckpoint,
} from '../desktop/project-library-v10-publication-host.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_TIMING,
	archiveProject,
} from './helpers/framescaper-v18-archive-fixture.ts';

const SOURCE_ID = 'framescaper-v10-lifecycle-source';
const COPY_ID = 'framescaper-v10-lifecycle-copy';
const TIMESTAMP = '2026-08-13T18:00:00.000Z';
const OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 42,
	instanceId: 'framescaper-v10-lifecycle',
});

test('lists sanitized catalog summaries and duplicates exact V18 proxy/timing ownership in main', async (context) => {
	const fixture = await createFixture(context);
	const source = await fixture.publishSource();
	assert.deepEqual(fixture.lifecycle.listProjects(), {
		metadataRevision: 1,
		projects: [{
			id: SOURCE_ID,
			title: 'Lifecycle source',
			revision: 0,
			updatedAt: new Date(100).toISOString(),
		}],
	});

	const duplicated = await fixture.lifecycle.duplicateProject({
		sourceProjectId: SOURCE_ID,
		copyProjectId: COPY_ID,
		title: 'Lifecycle copy',
		timestamp: TIMESTAMP,
		expectedMetadataRevision: source.metadataRevision,
		expectedSource: {
			projectRevision: source.project.projectRevision,
			projectSha256: source.project.sha256,
		},
	});
	const copiedProject = JSON.parse(duplicated.document) as FramescaperProjectV18;
	assert.equal(copiedProject.id, COPY_ID);
	assert.equal(copiedProject.title, 'Lifecycle copy');
	assert.equal(copiedProject.revision, 0);
	assert.equal(copiedProject.createdAt, TIMESTAMP);
	assert.equal(copiedProject.updatedAt, TIMESTAMP);
	assert.deepEqual(copiedProject.sources, (JSON.parse(source.document) as FramescaperProjectV18).sources);
	assert.equal(duplicated.metadataRevision, 2);
	const sourceAfter = await fixture.host.readProjectBundle(SOURCE_ID) as {
		readonly metadata: Readonly<{ readonly revision: number }>;
		readonly document: string;
		readonly bodies: readonly unknown[];
	};
	assert.equal(sourceAfter.metadata.revision, 2);
	assert.equal(sourceAfter.document, source.document);
	assert.deepEqual(sourceAfter.bodies, source.bodies);
	const copyAfter = await fixture.host.readProjectBundle(COPY_ID) as {
		readonly document: string;
		readonly bodies: readonly unknown[];
	};
	assert.equal(copyAfter.document, duplicated.document);
	assert.deepEqual(copyAfter.bodies, duplicated.bodies);
	assert.deepEqual(rows(fixture.database, `
		SELECT kind, count(*) AS count FROM managed_bodies GROUP BY kind ORDER BY kind
	`), [
		{ kind: 'video-proxy', count: 2 },
		{ kind: 'video-timing', count: 1 },
	]);
	assert.notEqual(duplicated.bodies[0]?.kind === 'video-proxy' && duplicated.bodies[0].bindingId,
		source.bodies[0]?.kind === 'video-proxy' && source.bodies[0].bindingId);
	for (const [index, body] of duplicated.bodies.entries()) {
		const bytes = await fixture.host.readBodyChunk(body, { offset: 0, length: body.byteLength });
		assert.equal(digest(bytes), source.bodies[index]?.sha256);
	}
});

test('deletes only the exact current catalog row and preserves immutable duplicate bodies', async (context) => {
	const fixture = await createFixture(context);
	const source = await fixture.publishSource();
	const copy = await fixture.lifecycle.duplicateProject({
		sourceProjectId: SOURCE_ID,
		copyProjectId: COPY_ID,
		title: 'Lifecycle copy',
		timestamp: TIMESTAMP,
		expectedMetadataRevision: source.metadataRevision,
		expectedSource: expected(source),
	});
	const before = fixture.database.serialize();
	assert.throws(() => fixture.lifecycle.deleteProject({
		projectId: SOURCE_ID,
		expectedMetadataRevision: 1,
		expectedProject: expected(source),
	}), /metadata.*compare-and-swap|revision/iu);
	assert.deepEqual(fixture.database.serialize(), before);

	assert.deepEqual(fixture.lifecycle.deleteProject({
		projectId: SOURCE_ID,
		expectedMetadataRevision: copy.metadataRevision,
		expectedProject: expected(source),
	}), { projectId: SOURCE_ID, metadataRevision: 3, deleted: true });
	assert.equal(await fixture.host.readProjectBundle(SOURCE_ID), null);
	const copyAfter = await fixture.host.readProjectBundle(COPY_ID) as {
		readonly metadata: Readonly<{ readonly revision: number }>;
		readonly document: string;
		readonly bodies: readonly unknown[];
	};
	assert.equal(copyAfter.metadata.revision, 3);
	assert.equal(copyAfter.document, copy.document);
	assert.deepEqual(copyAfter.bodies, copy.bodies);
	assert.equal(rows(fixture.database, 'SELECT * FROM project_revisions').length, 2);
	assert.equal(rows(fixture.database, 'SELECT * FROM managed_bodies').length, 3);
});

test('recovers duplicate and delete crashes without partial catalog or body state', async (context) => {
	let publicationStop: FramescaperDesktopProjectLibraryV10PublicationCheckpoint | null = null;
	let metadataStop: FramescaperDesktopProjectLibraryV10Checkpoint | null = null;
	const fixture = await createFixture(context, {
		publicationCheckpoint: (phase) => {
			if (publicationStop === phase) throw new Error(`stop publication ${phase}`);
		},
		metadataCheckpoint: (phase) => {
			if (metadataStop === phase) throw new Error(`stop metadata ${phase}`);
		},
	});
	const source = await fixture.publishSource();
	publicationStop = 'committed';
	await assert.rejects(fixture.lifecycle.duplicateProject({
		sourceProjectId: SOURCE_ID,
		copyProjectId: COPY_ID,
		title: 'Lifecycle copy',
		timestamp: TIMESTAMP,
		expectedMetadataRevision: source.metadataRevision,
		expectedSource: expected(source),
	}), /stop publication committed/u);
	publicationStop = null;
	assert.deepEqual(await fixture.host.recover({ lease: fixture.lease }), {
		outcome: 'committed', projectId: COPY_ID, projectRevision: 0, metadataRevision: 2,
	});
	assert.ok(await fixture.host.readProjectBundle(COPY_ID));

	metadataStop = 'prepared';
	assert.throws(() => fixture.lifecycle.deleteProject({
		projectId: SOURCE_ID,
		expectedMetadataRevision: 2,
		expectedProject: expected(source),
	}), /stop metadata prepared/u);
	metadataStop = null;
	assert.deepEqual(fixture.catalog.recoverMetadata({ lease: fixture.lease }), {
		outcome: 'interrupted', previousRevision: 2, publishedRevision: null,
	});
	assert.ok(await fixture.host.readProjectBundle(SOURCE_ID));

	metadataStop = 'committed';
	assert.throws(() => fixture.lifecycle.deleteProject({
		projectId: SOURCE_ID,
		expectedMetadataRevision: 2,
		expectedProject: expected(source),
	}), /stop metadata committed/u);
	metadataStop = null;
	assert.deepEqual(fixture.catalog.recoverMetadata({ lease: fixture.lease }), {
		outcome: 'committed', previousRevision: 2, publishedRevision: 3,
	});
	assert.equal(await fixture.host.readProjectBundle(SOURCE_ID), null);
	assert.ok(await fixture.host.readProjectBundle(COPY_ID));
});

interface FixtureOptions {
	readonly publicationCheckpoint?: (phase: FramescaperDesktopProjectLibraryV10PublicationCheckpoint) => void;
	readonly metadataCheckpoint?: (phase: FramescaperDesktopProjectLibraryV10Checkpoint) => void;
}

async function createFixture(context: TestContext, options: FixtureOptions = {}) {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-v10-lifecycle-'));
	context.after(() => rm(appDataPath, { force: true, recursive: true }));
	const database = new DatabaseSync(':memory:');
	context.after(() => database.close());
	initializeFramescaperDesktopProjectLibraryV10Database(database);
	const handshake = createFramescaperDesktopProjectLibraryV10Handshake();
	const catalog = FramescaperDesktopProjectLibraryV10Catalog.create({
		database,
		owner: OWNER,
		now: () => 100,
		randomId: ids('a', 'b', 'c', 'd'),
		...(options.metadataCheckpoint ? { checkpoint: options.metadataCheckpoint } : {}),
	});
	catalog.acceptHandshake(handshake);
	const lease = catalog.acquireLease({ ttlMs: 5_000 });
	const host = FramescaperDesktopProjectLibraryV10PublicationHost.create({
		database,
		appDataPath,
		now: () => 100,
		randomId: ids('e', 'f', '1', '2', '3', '4'),
		...(options.publicationCheckpoint ? { checkpoint: options.publicationCheckpoint } : {}),
	});
	host.acceptHandshake(handshake);
	const lifecycle = FramescaperDesktopProjectLibraryV10LifecycleHost.create({
		catalog,
		host,
		lease,
	});
	return {
		database,
		catalog,
		host,
		lease,
		lifecycle,
		async publishSource() {
			const project = archiveProject({ id: SOURCE_ID, revision: 0, title: 'Lifecycle source' });
			return host.publish({
				lease,
				expectedMetadataRevision: 0,
				expectedProject: null,
				project,
				bodies: publicationBodies(project),
			});
		},
	};
}

function publicationBodies(project: FramescaperProjectV18): FramescaperDesktopProjectLibraryV10PublicationBodyInput[] {
	const source = project.sources.find((candidate) => candidate.kind === 'video');
	assert.ok(source?.kind === 'video' && source.proxyAttachment);
	const attachment = source.proxyAttachment;
	const projectSha256 = digest(new TextEncoder().encode(JSON.stringify(project)));
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

function expected(bundle: Readonly<{
	readonly project: Readonly<{ readonly projectRevision: number; readonly sha256: string }>;
}>) {
	return Object.freeze({
		projectRevision: bundle.project.projectRevision,
		projectSha256: bundle.project.sha256,
	});
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> { yield bytes; }

function ids(...values: string[]) {
	let index = 0;
	return () => (values[index++] ?? '9').repeat(48);
}

function rows(database: DatabaseSync, sql: string): Record<string, unknown>[] {
	return database.prepare(sql).all().map((value) => ({ ...value }));
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
