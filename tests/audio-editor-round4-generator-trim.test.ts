/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { resolveTimelineTrimPointerPreview } from '../src/common/editor/ui/timeline/trim-pointer-routing.ts';

for (const edge of ['left', 'right'] as const) test(`the public generated Title ${edge} trim retains its native phase and one history entry`, async context => {
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
	const original = structuredClone(controller.project);
	assert.ok(original);
	const clip = original.clips.at(-1);
	assert.ok(clip);
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const projected = runtime.projectForCommandConsumers(original);
	const displayed = projected.clips.find(candidate => candidate.id === clip.id);
	assert.ok(displayed);
	const preview = resolveTimelineTrimPointerPreview({ project: projected, projectIndex: null,
		session: { clipId: String(clip.id), clipIds: [String(clip.id)], original: displayed },
		edge, requestedBoundarySample: edge === 'left' ? 48_000 : 192_000,
		legacyRequestedDelta: () => assert.fail('The generator owns its sequence boundary'),
		previewVideo: () => assert.fail('Generated visuals are not camera clips'),
		createLegacyPreview: () => assert.fail('Generated visuals do not use audio source bounds'),
	}) as Readonly<{ timelineStartFrame: number; durationFrames: number; sourceStartFrame: number }>;
	assert.equal(preview.timelineStartFrame, edge === 'left' ? 48_000 : 0);
	assert.equal(preview.durationFrames, 192_000);
	assert.equal(preview.sourceStartFrame, edge === 'left' ? 30 : 0);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.clip.trim(String(clip.id), edge === 'left'
		? { timelineStartFrame: 48_000 } : { durationFrames: 192_000 });
	const after = controller.project;
	assert.ok(after);
	assert.deepEqual(after.clips.find(candidate => candidate.id === clip.id), { ...clip,
		sequenceStartFrame: edge === 'left' ? 30 : 0, sequenceFrameCount: 120,
		sourceInFrame: edge === 'left' ? 30 : 0, sourceFrameCount: 120 });
	assert.deepEqual(after.sources, original.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, original.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
});
