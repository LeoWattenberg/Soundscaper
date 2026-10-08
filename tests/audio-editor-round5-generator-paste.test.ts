/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['overwrite', 'overwrite-middle', 'insert-middle'] as const) test(`Title ${mode} Paste owns native collisions and one complete Undo`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	await authoring.run('video-title');
	const before = environment.runtime.cloneProject(controller.project);
	const original = normalizeVideoGeneratorClipV1(before.clips.at(-1));
	controller.actions.timeline.selectClip(original.id);
	await controller.actions.edit.copy();
	assert.notEqual(controller.getSnapshot().status.state, 'error');
	if (mode !== 'overwrite') controller.actions.transport.seek(120_000);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	await (mode === 'insert-middle' ? controller.actions.edit.pasteInsert() : controller.actions.edit.pasteOverlap());
	assert.notEqual(controller.getSnapshot().status.state, 'error', JSON.stringify(controller.getSnapshot().status));
	const after = environment.runtime.cloneProject(controller.project);
	assert.equal(after.tracks.length, before.tracks.length);
	const clips = (after.clips as readonly Readonly<Record<string, unknown>>[])
		.filter(clip => clip.kind === 'generator').map(normalizeVideoGeneratorClipV1)
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
	const duration = original.sequenceFrameCount;
	const middle = duration / 2;
	assert.equal(clips.length, mode === 'overwrite' ? 1 : mode === 'overwrite-middle' ? 2 : 3);
	const copy = clips.find(clip => clip.sourceId !== original.sourceId);
	assert.ok(copy);
	assert.equal(copy.sequenceStartFrame, mode === 'overwrite' ? 0 : middle);
	assert.equal(copy.sequenceFrameCount, duration);
	assert.equal(copy.sourceInFrame, original.sourceInFrame);
	assert.equal(copy.sourceFrameCount, original.sourceFrameCount);
	const survivors = clips.filter(clip => clip.sourceId === original.sourceId);
	assert.deepEqual(survivors.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount]), mode === 'overwrite' ? []
		: mode === 'overwrite-middle' ? [[0, middle, 0, middle]] : [[0, middle, 0, middle], [middle + duration, middle, middle, middle]]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
