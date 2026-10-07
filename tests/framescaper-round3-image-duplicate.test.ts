/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const sourceStartTicks of ['0', '1000000']) test(`public Duplicate retains an image at source tick ${sourceStartTicks}, clipboard and atomic history`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const authoredClip = { ...fixture.clip, sourceStartTicks };
	const owner = fixture.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(fixture.clip.id));
	assert.ok(owner);
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline', trackId: owner.id }, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null,
		clip: authoredClip, placement: { scope: 'timeline', trackId: owner.id } }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	controller.actions.timeline.selectClip('audio-clip');
	controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	controller.actions.timeline.selectClip(fixture.clip.id);
	const before = controller.project;
	assert.ok(before);
	controller.actions.edit.duplicate();
	const after = controller.project;
	assert.ok(after);
	const copies = after.clips.filter(clip => clip.kind === 'image' && clip.id !== fixture.clip.id);
	assert.equal(copies.length, 1, JSON.stringify(controller.getSnapshot().status));
	const copy = copies[0]!;
	assert.deepEqual(copy, { ...authoredClip, id: copy.id });
	assert.equal(after.tracks.length, before.tracks.length + 1);
	assert.deepEqual(after.tracks.at(-1)?.clipIds, [copy.id]);
	assert.equal(controller.getSnapshot().selectedTrackId, after.tracks.at(-1)?.id);
	assert.equal(controller.getSnapshot().selectedClipId, copy.id);
	assert.deepEqual(after.clips.find(clip => clip.id === fixture.clip.id), authoredClip);
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
	controller.actions.timeline.selectClip('audio-clip');
	controller.actions.transport.seek(720_000);
	controller.actions.timeline.setSelection(720_000, 720_000, { trackIds: ['audio-track'] });
	await controller.actions.edit.pasteOverlap();
	assert.ok(controller.project?.clips.some(clip => clip.kind === 'audio' && clip.id !== 'audio-clip'));
	assert.equal(controller.project?.clips.filter(clip => clip.kind === 'image').length, 2,
		'Duplicate must leave the previously copied audio passage on the session clipboard');
});
