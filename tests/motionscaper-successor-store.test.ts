/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE } from '../src/framescaper/editor-project-successor-runtime-profile.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { openFramescaperCompositionLinkOwnerRepository } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import { createFramescaperSuccessorStoreAdapter } from '../src/framescaper/editor-project-successor-store-adapter.ts';
async function fixture() {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const media = new AudioEditorProjectStore({ indexedDB, projectStorageProfile: FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE, preferOpfs: false, memoryFallback: false }); await media.ready();
	const owners = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' }); const store = createFramescaperSuccessorStoreAdapter({ media, owners, runtime });
	return { factory, media, owners, runtime, store, close: async () => { await owners.close(); await media.close(); } };
}
test('successor store publishes exact history only to owner authority and excludes media cache roots from the catalog', async () => {
	const f = await fixture(); try {
		const project = f.runtime.createProject({ id: 'owned', title: 'Created' }); const created = await f.store.createProjectIfAbsent(project); assert.ok(created);
		assert.equal(await f.store.createProjectIfAbsent(project), null); const loaded = await f.store.loadProject(project.id); assert.ok(loaded);
		const fence = await f.store.claimProjectWriteFence(project.id);
		const history = f.runtime.executeCommand(f.runtime.createHistory(loaded), { type: 'project/rename', title: 'Saved' });
		const saved = await f.store.saveProjectIfCurrentWithWriteFence(loaded, f.runtime.cloneProject(history.present), fence); assert.ok(saved);
		assert.deepEqual((await f.owners.loadOwner(project.id))?.history, history);
		const listed = await f.store.listProjects(); assert.equal(listed.length, 1); assert.equal(listed[0]?.title, 'Saved');
		assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
		const cached = await f.media.listProjects(); assert.ok(cached.length > 0); assert.ok(cached.every((entry: unknown) => (entry as { cacheKind?: string }).cacheKind === 'framescaper-successor-media-roots'));
		const reopened = await f.store.loadProject(project.id); assert.deepEqual(f.runtime.createHistory(reopened), history);
		await assert.rejects(f.store.saveProject({ ...saved, title: 'Uncaptured' }), /snapshot|history/iu);
	} finally { await f.close(); }
});
test('successor store refuses stale write fences and retains committed owner when media admission fails', async () => {
	const f = await fixture(); try {
		const initial = await f.store.createProjectIfAbsent(f.runtime.createProject({ id: 'fenced' })); assert.ok(initial);
		const fence = await f.store.claimProjectWriteFence(initial.id); const history = f.runtime.executeCommand(f.runtime.createHistory(initial), { type: 'project/rename', title: 'Candidate' });
		await f.owners.claimOwnerWriteFence(initial.id);
		assert.equal(await f.store.saveProjectIfCurrentWithWriteFence(initial, history.present, fence), null);
		assert.equal((await f.owners.loadOwner(initial.id))?.project.title, initial.title);
		await assert.rejects(f.store.clear(), /custody|successor/iu);
		const active = await f.store.loadProject(initial.id); assert.ok(active); await f.store.claimProjectWriteFence(active.id);
		f.factory.failNextPutForStore('projects', new Error('cache quota'));
		const retry = f.runtime.executeCommand(f.runtime.createHistory(active), { type: 'project/rename', title: 'Will fail' });
		await assert.rejects(f.store.saveProject(retry.present), /cache quota|IndexedDB transaction failed/u); assert.equal((await f.owners.loadOwner(initial.id))?.project.title, initial.title);
	} finally { await f.close(); }
});
