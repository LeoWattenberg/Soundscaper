/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeProjectFileV18 } from '../src/framescaper/scape-project-file-v18.ts';
import type {
	FramescaperScapeArchiveDocumentPublicationV18,
} from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	ARCHIVE_PROXY_SHA,
	ARCHIVE_TIMING,
	archiveEntries,
	archiveManifest,
	archiveProject,
	storedValue,
} from './helpers/framescaper-v18-archive-fixture.ts';
import {
	FramescaperDesktopV10MainFixture,
	installFramescaperDesktopV10Bridge,
} from './helpers/framescaper-desktop-v10-store-fixture.ts';
import {
	setupFramescaperScapeFileV18,
} from './helpers/framescaper-v18-scape-file-test-support.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROXY_BODY_KEYS = [
	`video-proxy-sha256:${ARCHIVE_PROXY_SHA}`,
	ARCHIVE_TIMING.reference.storageKey,
];

test('desktop .scape create import publishes one fresh revision into the V10 catalog', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	installFramescaperDesktopV10Bridge(context, main.api);
	const environment = await desktopEnvironment(context);
	assert.notEqual(environment.desktopProjectLibrary, null);
	assert.notEqual(environment.controllerStore, environment.store);
	const blob = await scapeArchive(environment, project(environment, 'project_x', 12));

	const result = await environment.scapeProjectFile.importProject(blob, {
		decision: 'continue',
		operationId: 'desktop-scape-create',
		publication: { mode: 'create' },
	});

	assert.equal(result.status, 'published');
	assert.equal(result.publicationMode, 'create');
	assert.equal(Number(result.project.revision), 0);
	assert.deepEqual(
		(await environment.controllerStore.listProjects()).map(({ id, revision }) => ({ id, revision })),
		[{ id: 'project_x', revision: 0 }],
	);
	assert.deepEqual(await environment.store.loadProject('project_x'), result.project);
	assert.deepEqual(await environment.controllerStore.loadProject('project_x'), result.project);
	const saved = await environment.controllerStore.saveProject({
		...result.project, revision: 1, title: 'Edited after import',
	});
	assert.equal(Number(saved.revision), 1);
	assert.deepEqual(
		(await environment.controllerStore.listProjects()).map(({ id, revision }) => ({ id, revision })),
		[{ id: 'project_x', revision: 1 }],
	);
});

test('desktop .scape replace import compare-and-swaps the V10 catalog', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	installFramescaperDesktopV10Bridge(context, main.api);
	const environment = await desktopEnvironment(context);
	main.seed(project(environment, 'project_x', 3));
	const existing = await environment.controllerStore.loadProject('project_x') as FramescaperProjectV18;
	const blob = await scapeArchive(environment, project(environment, 'project_x', 12, 'Imported title'));

	const result = await environment.scapeProjectFile.importProject(blob, {
		decision: 'continue',
		operationId: 'desktop-scape-replace',
		publication: {
			mode: 'compare-and-swap',
			expected: existing,
			project: {
				...project(environment, 'project_x', 4, 'Imported title'),
				createdAt: existing.createdAt,
			},
		},
	});

	assert.equal(result.status, 'published');
	assert.equal(result.publicationMode, 'compare-and-swap');
	assert.equal(Number(result.project.revision), 4);
	assert.deepEqual(
		(await environment.controllerStore.listProjects()).map(({ id, revision }) => ({ id, revision })),
		[{ id: 'project_x', revision: 4 }],
	);
	const reloaded = await environment.controllerStore.loadProject('project_x') as FramescaperProjectV18;
	assert.deepEqual(reloaded, result.project);
	assert.equal(reloaded.title, 'Imported title');
	assert.equal(Number((await environment.controllerStore.saveProject({ ...reloaded, revision: 5 })).revision), 5);
});

test('web .scape import keeps publishing the file revision into the local V18 store', async (context) => {
	const environment = await desktopEnvironment(context);
	assert.equal(environment.desktopProjectLibrary, null);
	assert.equal(environment.controllerStore, environment.store);
	const blob = await scapeArchive(environment, project(environment, 'project_x', 12));

	const result = await environment.scapeProjectFile.importProject(blob, {
		decision: 'continue',
		operationId: 'web-scape-create',
		publication: { mode: 'create' },
	});

	assert.equal(result.status, 'published');
	assert.equal(Number(result.project.revision), 12);
	assert.deepEqual(await environment.store.loadProject('project_x'), result.project);
	assert.deepEqual((await environment.store.listProjects()).map(({ id }) => id), ['project_x']);
});

test('an admitted publisher owns the document only after this archive stages every body', async (context) => {
	const fixture = await setupFramescaperScapeFileV18(context);
	const origin = archiveProject({ revision: 12 });
	const staged: string[] = [];
	const publications: Readonly<FramescaperScapeArchiveDocumentPublicationV18>[] = [];
	const publisher = fixture.archive.admitDocumentPublisher(fixture.profile, fixture.storage.store, async (
		publication: Readonly<FramescaperScapeArchiveDocumentPublicationV18>,
	) => {
		publications.push(publication);
		for (const key of PROXY_BODY_KEYS) {
			if (await fixture.storage.store.getMediaAssetMetadata(key)) staged.push(key);
		}
		staged.push(String(await storedValue(fixture.storage.database, 'projects', String(origin.id))));
		return { ...publication.project, revision: 0 };
	});

	const result = await fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(), operationId: 'archive-delegated-create',
		publication: { mode: 'create' }, publisher,
	});

	assert.deepEqual(staged, [...PROXY_BODY_KEYS, 'undefined']);
	assert.deepEqual(publications.map(({ mode, expected }) => ({ mode, expected })), [
		{ mode: 'create', expected: null },
	]);
	assert.deepEqual(publications[0]?.project, origin);
	assert.deepEqual(result, {
		status: 'published', formatVersion: 2, project: { ...origin, revision: 0 },
		publicationMode: 'create',
	});
	assert.equal(await storedValue(fixture.storage.database, 'projects', String(origin.id)), undefined);
	assert.deepEqual(await claimInventory(fixture.storage.database), []);
	for (const key of PROXY_BODY_KEYS) {
		const row = await storedValue(fixture.storage.database, 'mediaAssets', key) as Record<string, unknown>;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), true);
	}
});

test('a refused delegated publication reports stale and leaves the local document untouched', async (context) => {
	const fixture = await setupFramescaperScapeFileV18(context);
	const origin = archiveProject({ revision: 12 });
	const publisher = fixture.archive.admitDocumentPublisher(fixture.profile, fixture.storage.store, () => null);

	const result = await fixture.archive.importProject({
		manifest: archiveManifest(origin), project: origin, decision: 'continue',
		entries: archiveEntries(), operationId: 'archive-delegated-stale',
		publication: { mode: 'create' }, publisher,
	});

	assert.equal(result.status, 'stale');
	assert.equal(await storedValue(fixture.storage.database, 'projects', String(origin.id)), undefined);
});

test('only the exact archive-admitted publisher can own an imported document', async (context) => {
	const fixture = await setupFramescaperScapeFileV18(context);
	const foreign = await setupFramescaperScapeFileV18(context);
	const publisher = foreign.archive.admitDocumentPublisher(
		foreign.profile, foreign.storage.store, ({ project }) => project,
	);
	const counterfeit = Object.freeze({ publish: async () => null });

	for (const candidate of [publisher, counterfeit]) {
		assert.throws(() => new FramescaperScapeProjectFileV18(fixture.profile, {
			archive: fixture.archive, store: fixture.storage.store, publisher: candidate,
		}), /exact.*composition/iu);
		await assert.rejects(fixture.archive.importProject({
			manifest: archiveManifest(archiveProject()), project: archiveProject(), decision: 'continue',
			entries: archiveEntries(), operationId: 'archive-counterfeit-publisher',
			publication: { mode: 'create' }, publisher: candidate,
		}), /admitted.*publisher/iu);
	}
	assert.throws(() => fixture.archive.admitDocumentPublisher(
		fixture.profile, foreign.storage.store, ({ project }) => project,
	), /exact.*composition/iu);
});

async function desktopEnvironment(
	context: TestContext,
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	return environment;
}

function project(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	id: string,
	revision: number,
	title = 'Project X',
): FramescaperProjectV18 {
	return {
		...environment.runtime.createProject({ id, title, now: '2026-08-13T10:00:00.000Z' }),
		revision,
	};
}

async function scapeArchive(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	source: FramescaperProjectV18,
): Promise<Blob> {
	const exported = await environment.scapeProjectFile.exportProject(source);
	assert.ok(exported.blob);
	return exported.blob;
}

async function claimInventory(database: IDBDatabase): Promise<unknown[]> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(mediaAssetStaging.index('kind').getAll('video-proxy-claim')),
	);
}
