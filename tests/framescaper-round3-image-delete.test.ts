/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';

for (const rippleMode of ['none', 'clip', 'track'] as const) test(`normal timeline image removal preserves ${rippleMode} semantics and one-step history`, () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const owner = fixture.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(fixture.clip.id));
	assert.ok(owner);
	let history = runtime.createHistory(fixture.project);
	const following = { ...fixture.clip, id: 'following-image', sequenceStartFrame: 150, sourceStartTicks: '1000000' };
	history = runtime.executeCommand(history, { type: 'image-clip/set', clipId: following.id,
		expectedClip: null, expectedPlacement: null, clip: following, placement: { scope: 'timeline', trackId: owner.id } });
	history = runtime.executeCommand(history, { type: 'selection/set', startFrame: 0, endFrame: 0,
		clipIds: [fixture.clip.id], trackIds: [owner.id] });
	const before = history.present;
	history = runtime.executeCommand(history, { type: 'clip/remove-many', clipIds: [fixture.clip.id], rippleMode });
	assert.equal(history.present.clips.some(clip => clip.id === fixture.clip.id), false);
	assert.deepEqual(history.present.clips.find(clip => clip.id === following.id), {
		...following, sequenceStartFrame: rippleMode === 'track' ? 0 : 150,
	});
	assert.deepEqual(history.present.tracks.find(track => track.id === owner.id)?.clipIds, [following.id]);
	assert.deepEqual(history.present.selection.clipIds, []);
	assert.deepEqual(history.present.sources, before.sources);
	const after = history.present;
	history = runtime.undo(history);
	assert.deepEqual(history.present, { ...before, revision: history.present.revision, updatedAt: history.present.updatedAt });
	history = runtime.redo(history);
	assert.deepEqual(history.present, { ...after, revision: history.present.revision, updatedAt: history.present.updatedAt });
});

test('one normal multi-selection removes image and audio leaves together', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const before = runtime.createHistory(fixture.project);
	const after = runtime.executeCommand(before, { type: 'clip/remove-many', clipIds: [fixture.clip.id, 'audio-clip'], rippleMode: 'none' });
	assert.deepEqual(after.present.clips, []);
	assert.deepEqual(after.present.tracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds : []), []);
	assert.equal(after.undoStack.length, before.undoStack.length + 1);
});

test('deleting an image closes its exact picture-track gap before a normal video', () => {
	const fixture = createFramescaperBaselineImageFixture();
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(fixture.project);
	history = runtime.executeCommand(history, { type: 'clip/move', clipId: 'video-clip', timelineStartFrame: 720_000 });
	const video = history.present.clips.find(clip => clip.id === 'video-clip');
	assert.ok(video);
	history = runtime.executeCommand(history, { type: 'clip/remove-many', clipIds: [fixture.clip.id], rippleMode: 'track' });
	assert.deepEqual(history.present.clips.find(clip => clip.id === 'video-clip'), { ...video, sequenceStartFrame: 0 });
	assert.equal(history.present.clips.some(clip => clip.id === fixture.clip.id), false);
});

test('the real Framescaper controller removes a header-selected image through public Delete and restores it on Undo', async () => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(item => Array.isArray(item.clipIds) && item.clipIds.includes(fixture.clip.id));
	assert.ok(track);
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline', trackId: track.id }, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null,
		clip: fixture.clip, placement: { scope: 'timeline', trackId: track.id } }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = createFramescaperAudioEditorController(environment);
	try {
		await controller.ready;
		await controller.actions.project.openById(fixture.project.id);
		controller.actions.timeline.selectClip(fixture.clip.id);
		controller.actions.edit.deleteLeaveGap();
		assert.equal(controller.project?.clips.some(clip => clip.id === fixture.clip.id), false);
		assert.equal(controller.getSnapshot().selectedClipId, null);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips.find(clip => clip.id === fixture.clip.id), fixture.clip);
	} finally { await controller.dispose(); await environment.close(); }
});
