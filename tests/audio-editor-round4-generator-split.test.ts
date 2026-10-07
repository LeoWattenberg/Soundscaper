/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { FOUNDATION_TIME_CONVERSION_SITES } from '../src/common/editor/foundation-time-conversion-audit.ts';

for (const trimmed of [false, true]) test(`public Split preserves generated Title source phase${trimmed ? ' after trimming' : ''}`, async context => {
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
	const id = String(controller.project?.clips.at(-1)?.id);
	if (trimmed) controller.actions.clip.trim(id, { timelineStartFrame: 48_000 });
	const before = structuredClone(controller.project);
	assert.ok(before);
	const original = normalizeVideoGeneratorClipV1(before.clips.find(clip => clip.id === id));
	const trackId = before.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(id))?.id;
	assert.ok(trackId);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.splitAt(96_000, [trackId]);
	const after = controller.project;
	assert.ok(after);
	assert.equal(after.clips.length, 2);
	const left = normalizeVideoGeneratorClipV1(after.clips.find(clip => clip.id === id));
	const right = normalizeVideoGeneratorClipV1(after.clips.find(clip => clip.id !== id));
	assert.deepEqual(left, { ...original, sequenceFrameCount: trimmed ? 30 : 60,
		sourceFrameCount: trimmed ? 30 : 60 });
	assert.deepEqual(right, { ...original, id: right.id, sequenceStartFrame: 60,
		sequenceFrameCount: 90, sourceInFrame: 60, sourceFrameCount: 90 });
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	if (!trimmed) {
		controller.actions.edit.undo();
		controller.actions.edit.commit({ type: 'batch', commands: [
			{ type: 'clip/split', clipId: id, atFrame: 144_000, rightClipId: 'last-title' },
			{ type: 'clip/split', clipId: id, atFrame: 48_000, rightClipId: 'middle-title' },
		] });
		const pieces = controller.project?.clips.map(normalizeVideoGeneratorClipV1)
			.sort((leftClip, rightClip) => leftClip.sequenceStartFrame - rightClip.sequenceStartFrame);
		assert.deepEqual(pieces?.map(piece => [piece.sequenceStartFrame, piece.sequenceFrameCount,
			piece.sourceInFrame, piece.sourceFrameCount]), [[0, 30, 0, 30], [30, 60, 30, 60], [90, 60, 90, 60]]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips, before.clips);
	}
});

test('generated visual split boundaries have an exact nearest-sequence-point policy', () => {
	const site = FOUNDATION_TIME_CONVERSION_SITES.find(candidate => candidate.id === 'timeline-generator-split-boundary');
	assert.equal(site?.file, 'src/framescaper/editor-timeline-generator-split-command.ts');
	assert.deepEqual(site?.conversions, [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }]);
});
