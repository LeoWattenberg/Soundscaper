/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	FramescaperScapeArchiveV18,
} from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	ARCHIVE_PROJECT_ID,
	ARCHIVE_PROXY_SHA,
	ARCHIVE_TIMING,
	archiveCopy,
	archiveEntries,
	archiveManifest,
	archiveProject,
	createFramescaperV18ArchiveFixture,
	revisionKey,
	storedValue,
	type FramescaperV18ArchiveFixture,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('Cancel completes after metadata inspection with zero entry, store, or claim I/O', async (context) => {
	const fixture = await setup(context);
	const project = archiveProject();
	let entryGets = 0;
	const entries = new Proxy([], {
		get() { entryGets += 1; throw new Error('entry get'); },
		ownKeys() { entryGets += 1; throw new Error('entry keys'); },
	});
	const result = await fixture.archive.importProject({
		manifest: archiveManifest(project), project, decision: 'cancel', entries,
		operationId: 'archive-cancel', publication: { mode: 'create' },
	});
	assert.deepEqual(result, {
		status: 'cancelled', formatVersion: 2, project, publicationMode: null,
	});
	assert.equal(entryGets, 0);
	assert.deepEqual(fixture.storage.store.calls, { metadata: 0, load: 0, begin: 0 });
	assert.deepEqual(await claimInventory(fixture.storage.database), []);
	assert.equal(await storedValue(fixture.storage.database, 'projects', String(project.id)), undefined);

	const allNull = archiveProject({ attached: false });
	const format1Manifest = { ...archiveManifest(allNull), formatVersion: 1, assets: [
		(archiveManifest(allNull).assets as unknown[])[0],
	] };
	assert.equal((await fixture.archive.importProject({
		manifest: format1Manifest, project: allNull, decision: 'cancel', entries,
		operationId: 'archive-cancel-format-1', publication: { mode: 'create' },
	})).formatVersion, 1);
	assert.equal(entryGets, 0);
});

test('create verifies and stages both bodies before one claim-authenticated publication', async (context) => {
	const fixture = await setup(context);
	const project = archiveProject({ revision: 3 });
	const bodyReads: string[] = [];
	const result = await fixture.archive.importProject({
		manifest: archiveManifest(project), project, decision: 'continue',
		entries: archiveEntries((entry) => bodyReads.push(entry)),
		operationId: 'archive-create', publication: { mode: 'create' },
	});

	assert.deepEqual(result, {
		status: 'published', formatVersion: 2, project, publicationMode: 'create',
	});
	assert.equal(result.project === project, false);
	assert.deepEqual(bodyReads, [
		`proxy/${ARCHIVE_PROXY_SHA}/body`,
		`timing/${ARCHIVE_TIMING.reference.sha256}.scti`,
	]);
	assert.deepEqual(await storedValue(fixture.storage.database, 'projects', String(project.id)), project);
	assert.deepEqual(
		await storedValue(fixture.storage.database, 'revisions', revisionKey(String(project.id), 3)),
		{ key: revisionKey(String(project.id), 3), projectId: project.id, revision: 3, project },
	);
	assert.deepEqual(await claimInventory(fixture.storage.database), []);
	for (const key of [
		`video-proxy-sha256:${ARCHIVE_PROXY_SHA}`,
		ARCHIVE_TIMING.reference.storageKey,
	]) {
		const row = await storedValue(fixture.storage.database, 'mediaAssets', key) as Record<string, unknown>;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), false);
	}
});

test('collision copy preserves exact attachments and bodies under a fresh project identity', async (context) => {
	const fixture = await setup(context);
	const origin = archiveProject({ revision: 7 });
	const copy = archiveCopy(origin);
	const result = await fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(), operationId: 'archive-copy',
		publication: { mode: 'copy', project: copy },
	});
	assert.equal(result.status, 'published');
	assert.deepEqual(result.project, copy);
	assert.equal(await storedValue(fixture.storage.database, 'projects', String(origin.id)), undefined);
	assert.deepEqual(await storedValue(fixture.storage.database, 'projects', String(copy.id)), copy);
	assert.deepEqual(
		await storedValue(fixture.storage.database, 'revisions', revisionKey(String(copy.id), 0)),
		{ key: revisionKey(String(copy.id), 0), projectId: copy.id, revision: 0, project: copy },
	);
});

test('replacement uses exact CAS and leaves verified claims rooted when stale', async (context) => {
	const fixture = await setup(context);
	const origin = archiveProject({ revision: 8 });
	const expected = archiveProject({ attached: false, title: 'Expected base' });
	const changed = archiveProject({ attached: false, title: 'Changed elsewhere' });
	await seedProject(fixture.storage.database, changed);
	const next = replacement(origin, expected);

	const result = await fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(), operationId: 'archive-stale',
		publication: { mode: 'compare-and-swap', expected, project: next },
	});
	assert.equal(result.status, 'stale');
	assert.deepEqual(await storedValue(fixture.storage.database, 'projects', ARCHIVE_PROJECT_ID), changed);
	assert.equal(await storedValue(
		fixture.storage.database, 'revisions', revisionKey(ARCHIVE_PROJECT_ID, 1),
	), undefined);
	assert.equal((await claimInventory(fixture.storage.database)).length, 2);
});

test('exact CAS commits the next revision and body-row races abort the entire transaction', async (context) => {
	const fixture = await setup(context);
	const origin = archiveProject({ revision: 8 });
	const expected = archiveProject({ attached: false, title: 'Expected base' });
	await seedProject(fixture.storage.database, expected);
	const next = replacement(origin, expected);
	const result = await fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(), operationId: 'archive-cas',
		publication: { mode: 'compare-and-swap', expected, project: next },
	});
	assert.equal(result.status, 'published');
	assert.deepEqual(await storedValue(fixture.storage.database, 'projects', ARCHIVE_PROJECT_ID), next);
	assert.deepEqual(await claimInventory(fixture.storage.database), []);

	const second = await setup(context);
	await seedProject(second.storage.database, expected);
	second.storage.store.calls.metadata = 0;
	const corrupt = archiveEntries(undefined, { proxy: Uint8Array.of(1, 2, 3) });
	await assert.rejects(second.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue', entries: corrupt,
		operationId: 'archive-corrupt',
		publication: { mode: 'compare-and-swap', expected, project: next },
	}), /size|digest|bytes|emitted/iu);
	assert.deepEqual(await storedValue(second.storage.database, 'projects', ARCHIVE_PROJECT_ID), expected);
	assert.deepEqual(await claimInventory(second.storage.database), []);
});

test('publication request and entry geometry fail before archive body reads', async (context) => {
	const fixture = await setup(context);
	const origin = archiveProject();
	let reads = 0;
	await assert.rejects(fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(() => { reads += 1; }), operationId: 'archive-invalid-copy',
		publication: { mode: 'copy', project: { ...archiveCopy(origin), revision: 4 } },
	}), /copy.*revision 0|revision.*copy/iu);
	assert.equal(reads, 0);

	const entries = archiveEntries(() => { reads += 1; });
	entries[0] = { ...entries[0]!, compressionMethod: 8 };
	await assert.rejects(fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue', entries,
		operationId: 'archive-compressed', publication: { mode: 'create' },
	}), /STORE|compression/iu);
	assert.equal(reads, 0);
});

interface Fixture {
	readonly storage: FramescaperV18ArchiveFixture;
	readonly archive: FramescaperScapeArchiveV18;
}

async function setup(context: TestContext): Promise<Fixture> {
	const storage = await createFramescaperV18ArchiveFixture(context);
	let generation = 0;
	return {
		storage,
		archive: new FramescaperScapeArchiveV18(PROFILE, {
			store: storage.store, port: storage.port, opfs: storage.opfs,
			now: () => 1_786_550_400_000,
			createGeneration: () => `archive-claim-generation-${String(++generation).padStart(4, '0')}`,
		}),
	};
}

function replacement(
	origin: FramescaperProjectV18,
	expected: FramescaperProjectV18,
): FramescaperProjectV18 {
	return {
		...structuredClone(origin), id: expected.id, revision: Number(expected.revision) + 1,
		createdAt: expected.createdAt, updatedAt: '2026-08-13T12:00:00.000Z',
	};
}

async function seedProject(database: IDBDatabase, project: FramescaperProjectV18): Promise<void> {
	await transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put(project);
		revisions.put({
			key: revisionKey(String(project.id), Number(project.revision)), projectId: project.id,
			revision: project.revision, project,
		});
	});
}

async function claimInventory(database: IDBDatabase): Promise<unknown[]> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(mediaAssetStaging.index('kind').getAll('video-proxy-claim')),
	);
}
