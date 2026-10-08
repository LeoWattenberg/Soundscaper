/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['overwrite', 'overwrite-middle', 'insert-middle'] as const) test(`image ${mode} Paste preserves animated survivor phase and one Undo`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const owner = fixture.project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(fixture.clip.id));
	assert.ok(owner);
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline', trackId: owner.id }, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null },
	{ type: 'track/remove', trackId: 'audio-track' }, { type: 'source/remove', sourceId: 'audio-source' }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null,
		clip: fixture.clip, placement: { scope: 'timeline', trackId: owner.id } }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	controller.actions.timeline.selectClip(fixture.clip.id);
	await controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	if (mode !== 'overwrite') controller.actions.transport.seek(120_000);
	const before = environment.runtime.cloneProject(controller.project);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	await (mode === 'insert-middle' ? controller.actions.edit.pasteInsert() : controller.actions.edit.pasteOverlap());
	assert.notEqual(controller.getSnapshot().status.state, 'error', JSON.stringify(controller.getSnapshot().status));
	const after = environment.runtime.cloneProject(controller.project);
	const clips = after.clips.filter(clip => clip.kind === 'image').map(normalizeFramescaperImageClipV1)
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	assert.equal(clips.length, mode === 'overwrite' ? 1 : mode === 'overwrite-middle' ? 2 : 3);
	const pasted = clips.find(clip => clip.id !== fixture.clip.id && clip.sequenceFrameCount === 150);
	assert.ok(pasted);
	assert.equal(pasted.sequenceStartFrame, mode === 'overwrite' ? 0 : 25);
	assert.equal(pasted.sourceStartTicks, '0');
	const survivors = clips.filter(clip => clip.id !== pasted.id);
	assert.deepEqual(survivors.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceStartTicks]), mode === 'overwrite' ? []
		: mode === 'overwrite-middle' ? [[0, 25, '0']] : [[0, 25, '0'], [175, 125, '2500000']]);
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
