/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createFramescaperCompositionPlacement } from '../src/framescaper/editor-composition-link-placement.ts';
import { createFramescaperSuccessorHistory, executeFramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';

async function fixture() {
	const factory = createInstrumentedIndexedDB();
	const options = { line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } };
	const original = await createFramescaperSuccessorEnvironment(options);
	const motion = createMotionscaperRevision(createMotionscaperProject({ id: 'offline-motion', title: 'Linked scene', compositionId: 'main', width: 2, height: 2, durationFrames: 3 }));
	const offer = createMotionCompositionOffer('main', motion);
	const initial = createFramescaperSuccessorHistory(original.runtime.createProject({ id: 'offline-owner', title: 'Linked owner' }));
	const owner = await original.owners.saveOwner(initial.present, null, initial);
	const prepared = await original.owners.prepareReceive(owner.project.id, 'linked', offer, { readAsset: async () => null });
	const next = executeFramescaperSuccessorHistory(initial, createFramescaperCompositionPlacement({ project: initial.present, offer, sourceId: 'linked', audioSourceId: 'linked-audio', videoTrackId: 'video-track', audioTrackId: 'audio-track', videoClipId: 'video-clip', audioClipId: 'audio-clip', avLinkId: 'av-link' }));
	const project = next.present;
	try { await prepared.commit({ expectedOwnerDigest: owner.ownerDigest, project, history: next }); } finally { await original.close(); }
	return { factory, project, environment: await createFramescaperSuccessorEnvironment(options) };
}

function refuseUncachedPortableModule() {
	let requests = 0;
	const hook = registerHooks({ resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('/editor-project-successor-portable-import.ts')) {
			requests++; throw new Error('Portable recovery module is not cached offline.');
		}
		return nextResolve(specifier, context);
	} });
	return { hook, requests: () => requests };
}

test('M10 linked-only owner reopens without fetching unused portable recovery code', async () => {
	const f = await fixture(); const blocked = refuseUncachedPortableModule();
	try {
		assert.deepEqual(await f.environment.controllerStore.loadProject(f.project.id), f.project);
		assert.deepEqual(await f.environment.controllerStore.loadProject(f.project.id), f.project);
		assert.equal(blocked.requests(), 0);
	} finally { blocked.hook.deregister(); await f.environment.close(); }
});

test('M10 an absent portable record is rechecked and new custody cannot bypass its authenticated loader', async () => {
	const f = await fixture(); const blocked = refuseUncachedPortableModule();
	try {
		assert.deepEqual(await f.environment.controllerStore.loadProject(f.project.id), f.project);
		f.factory.seedRecord('kw-media-framescaper-editor-v2', 'portableArchives', { id: f.project.id, kind: 'forged' });
		await assert.rejects(f.environment.controllerStore.loadProject(f.project.id), /not cached offline/u);
		assert.equal(blocked.requests(), 1);
		assert.deepEqual((await f.environment.owners.loadOwner(f.project.id))?.project, f.project);
	} finally { blocked.hook.deregister(); await f.environment.close(); }
});

test('M10 pre-cancelled reopen does not query a missing portable module or adopt the owner', async () => {
	const f = await fixture(); const blocked = refuseUncachedPortableModule(); const abort = new AbortController(); abort.abort();
	try {
		await assert.rejects(f.environment.controllerStore.loadProject(f.project.id, { signal: abort.signal }), { name: 'AbortError' });
		assert.equal(blocked.requests(), 0);
		assert.throws(() => f.environment.controllerStore.captureOwnerDigest(f.project), /changed|reload/u);
	} finally { blocked.hook.deregister(); await f.environment.close(); }
});

test('M10 present corrupt portable custody still refuses adoption through the real recovery validator', async () => {
	const f = await fixture();
	try {
		f.factory.seedRecord('kw-media-framescaper-editor-v2', 'portableArchives', { id: f.project.id, kind: 'forged' });
		await assert.rejects(f.environment.controllerStore.loadProject(f.project.id), /portable custody/u);
		assert.throws(() => f.environment.controllerStore.captureOwnerDigest(f.project), /changed|reload/u);
	} finally { await f.environment.close(); }
});
