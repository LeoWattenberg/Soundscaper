/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperDesktopProjectStoreV10Adapter,
} from '../src/framescaper/desktop-project-library-v10-store-adapter.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	lifecycleFixture,
	projectFixture,
	webLifecycleFixture,
	type MutableFramescaperProject,
} from './helpers/framescaper-desktop-v10-store-fixture.ts';

test('web composition returns the exact local V18 store with no wrapper authority', async (context) => {
	const fixture = await webLifecycleFixture(context);
	assert.equal(createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: fixture.localStore, desktopProjectLibrary: null },
	), fixture.localStore);
	assert.throws(() => createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: {} as never, desktopProjectLibrary: null },
	), /exact|local store|authority/iu);
});

test('load always refreshes main while revision loads remain shadow-local', async (context) => {
	const fixture = await lifecycleFixture(context);
	const first = projectFixture({ id: 'authoritative-load', revision: 0 });
	fixture.main.seed(first);
	assert.deepEqual(await fixture.store.loadProject(String(first.id)), first);

	const second = projectFixture({ id: String(first.id), revision: 1, title: 'Refreshed main' });
	fixture.main.seed(second);
	assert.deepEqual(await fixture.store.loadProject(String(first.id)), second);
	assert.deepEqual(fixture.main.reads, ['authoritative-load', 'authoritative-load']);
	assert.deepEqual(await fixture.localStore.loadProject(String(first.id)), second);

	assert.deepEqual(await fixture.store.loadProject(String(first.id), { revision: 0 }), first);
	assert.equal(fixture.main.reads.length, 2);
	assert.equal(Object.hasOwn(fixture.store, 'desktopProjectLibrary'), false);
	assert.equal(JSON.stringify(fixture.store).includes('projectSha256'), false);
});

test('save commits in main before exact local shadow reconciliation', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'main-first-save', revision: 0 });
	fixture.main.seed(current);
	await fixture.store.loadProject(String(current.id));
	const project = projectFixture({ id: String(current.id), revision: 1, title: 'Main first' });
	fixture.main.beforeFinish = async () => {
		assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);
	};

	const events: string[] = [];
	const saved = await fixture.store.saveProject(project, {
		admitProjectPublication: async () => { events.push('admitted'); },
		protectedLinkedOriginalSourceReferences: [],
	});
	assert.deepEqual(saved, project);
	assert.deepEqual(events, ['admitted']);
	assert.deepEqual(fixture.main.events.slice(-2), ['begin', 'finish']);
	assert.deepEqual(await fixture.localStore.loadProject(String(project.id)), project);
	assert.deepEqual(Reflect.ownKeys(fixture.main.lastBegin!), [
		'publicationId', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies',
	]);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('lease'), false);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('path'), false);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('callback'), false);
});

test('save refuses missing and stale private witnesses before main or local mutation', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'witness-save', revision: 0 });
	fixture.main.seed(current);
	const next = projectFixture({ id: String(current.id), revision: 1 });
	await assert.rejects(fixture.store.saveProject(next), /authoritative.*witness/iu);
	assert.equal(fixture.main.publications, 0);
	assert.equal(await fixture.localStore.loadProject(String(current.id)), null);

	// A witness admits only a strictly higher revision: replaying the witnessed
	// revision is stale, while a coalesced autosave that advanced the in-memory
	// project more than once is admitted.
	await fixture.store.loadProject(String(current.id));
	const replayed = projectFixture({ id: String(current.id), revision: 0 });
	await assert.rejects(fixture.store.saveProject(replayed), /stale.*witness/iu);
	assert.equal(fixture.main.publications, 0);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);

	await fixture.store.loadProject(String(current.id));
	const coalesced = projectFixture({ id: String(current.id), revision: 2 });
	assert.deepEqual(await fixture.store.saveProject(coalesced), coalesced);
	assert.equal(fixture.main.publications, 1);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), coalesced);
});

test('create is main-first, collision-safe, and consumes its absence witness once', async (context) => {
	const fixture = await lifecycleFixture(context);
	const project = projectFixture({ id: 'desktop-create', revision: 0 });
	fixture.main.beforeFinish = async () => {
		assert.equal(await fixture.localStore.loadProject(String(project.id)), null);
	};
	assert.deepEqual(await fixture.store.createProjectIfAbsent(project), project);
	assert.deepEqual(await fixture.localStore.loadProject(String(project.id)), project);
	assert.equal(await fixture.store.createProjectIfAbsent(project), null);
	assert.equal(fixture.main.publications, 1);
	assert.deepEqual(fixture.main.reads, ['desktop-create', 'desktop-create']);
});

test('create binds destination absence to the exact nonempty main catalog revision', async (context) => {
	const fixture = await lifecycleFixture(context);
	fixture.main.seed(projectFixture({ id: 'existing-catalog-project', revision: 0 }));
	const project = projectFixture({ id: 'second-desktop-create', revision: 0 });
	assert.deepEqual(await fixture.store.createProjectIfAbsent(project), project);
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id).sort(), [
		'existing-catalog-project',
		'second-desktop-create',
	]);
});

test('desktop lists, duplicates, and deletes through main before reconciling the exact local shadow', async (context) => {
	const fixture = await lifecycleFixture(context);
	const source = projectFixture({ id: 'desktop-lifecycle-source', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(String(source.id));
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id), [source.id]);
	const copy = await fixture.store.duplicateProject(String(source.id), {
		id: 'desktop-lifecycle-copy',
		title: 'Desktop lifecycle copy',
	}) as FramescaperProjectV18;
	assert.equal(copy.id, 'desktop-lifecycle-copy');
	assert.equal(copy.revision, 0);
	assert.equal(copy.multicameraGroups[0]?.projectId, 'desktop-lifecycle-copy');
	assert.deepEqual(await fixture.localStore.loadProject(String(copy.id)), copy);
	await fixture.store.loadProject(String(source.id));
	await fixture.store.deleteProject(String(source.id));
	assert.equal(await fixture.localStore.loadProject(String(source.id)), null);
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id), [copy.id]);
	assert.deepEqual(fixture.store.getStatus(), fixture.localStore.getStatus());
	assert.equal(await fixture.store.saveSetting('desktop-adapter', 'value'), 'value');
	assert.equal(await fixture.localStore.loadSetting('desktop-adapter', null), 'value');
	assert.equal(fixture.store.preservesProjectsOnClear(), true);
	assert.equal(fixture.store.prepareProjectHandoff, undefined);
});

test('desktop V10 main JSON and the exact V18 shadow preserve a nonempty subsequence graph', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'nested-main-shadow', revision: 0, nested: true });
	fixture.main.seed(current);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), current);
	assert.deepEqual((await fixture.localStore.loadProject(String(current.id)) as FramescaperProjectV18).subsequences,
		current.subsequences);

	const next = { ...structuredClone(current), revision: 1, title: 'Nested main and shadow' };
	assert.deepEqual(await fixture.store.saveProject(next), next);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), next);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), next);
	assert.deepEqual((fixture.main.lastBegin?.project as FramescaperProjectV18).subsequences,
		current.subsequences);
});

test('desktop V10 main JSON and the exact V18 shadow preserve a nonempty multicamera graph', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'multicamera-main-shadow', revision: 0, multicamera: true });
	fixture.main.seed(current);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), current);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);

	const next = structuredClone(current) as unknown as MutableFramescaperProject;
	next.revision = 1;
	next.title = 'Multicamera main and shadow';
	next.multicameraGroups[0]!.activeMemberId = 'desktop-camera-b';
	assert.deepEqual(await fixture.store.saveProject(next), next);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), next);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), next);
	assert.deepEqual(
		(fixture.main.lastBegin?.project as FramescaperProjectV18).multicameraGroups,
		next.multicameraGroups,
	);
});
