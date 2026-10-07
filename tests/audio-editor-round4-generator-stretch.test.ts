/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { resolveTimelineRateStretchPointerPreview, commitTimelineRateStretchPointer } from '../src/common/editor/ui/timeline/rate-stretch-pointer-routing.ts';
import { FOUNDATION_TIME_CONVERSION_SITES } from '../src/common/editor/foundation-time-conversion-audit.ts';

for (const edge of ['left', 'right'] as const) test(`the public generated Title ${edge} stretch preserves native source phase and one Undo`, async context => {
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
	controller.actions.clip.trim(id, { timelineStartFrame: 48_000 });
	const original = structuredClone(controller.project);
	assert.ok(original);
	const clip = original.clips.find(candidate => candidate.id === id);
	assert.ok(clip);
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const projected = runtime.projectForCommandConsumers(original);
	const displayed = projected.clips.find(candidate => candidate.id === id);
	assert.ok(displayed);
	const session = { kind: `stretch-${edge}`, clipId: id, clipIds: [id], original: displayed };
	const requestedBoundarySample = edge === 'left' ? 0 : 336_000;
	const input = { project: projected, session, canonicalVideoTrim: true, requestedBoundarySample,
		previewOrdinary: () => assert.fail('Generated visuals have a native sequence clock'),
		previewRateStretch: () => assert.fail('Generated visuals are not camera sources') };
	const preview = resolveTimelineRateStretchPointerPreview(input) as Readonly<{ timelineStartFrame: number; durationFrames: number }>;
	assert.equal(preview.timelineStartFrame, edge === 'left' ? 0 : 48_000);
	assert.equal(preview.durationFrames, edge === 'left' ? 240_000 : 288_000);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	const commitInput = { project: projected, session, canonicalVideoTrim: true, requestedBoundarySample,
		commitOrdinary: () => assert.fail('Generated visuals must not invoke audio stretch'),
		commitRateStretch: () => assert.fail('Generated visuals do not use camera trim allocation'),
		commitGenerated: (command: unknown) => controller.actions.edit.commit(command) };
	commitTimelineRateStretchPointer(commitInput);
	const after = controller.project;
	assert.ok(after);
	assert.deepEqual(after.clips.find(candidate => candidate.id === id), { ...clip,
		sequenceStartFrame: edge === 'left' ? 0 : 30, sequenceFrameCount: edge === 'left' ? 150 : 180 });
	assert.deepEqual(after.sources, original.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, original.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
});

test('generated stretch and preview own nearest-sequence and sample-point conversion policies', () => {
	for (const [id, file, helper] of [
		['timeline-generator-rate-stretch-boundary', 'src/common/editor/timeline-generator-rate-stretch.ts', 'sampleFrameToVideoFrame'],
		['timeline-generator-rate-stretch-preview', 'src/common/editor/ui/timeline/generator-rate-stretch-pointer.ts', 'videoFrameToSampleFrame'],
	] as const) {
		const site = FOUNDATION_TIME_CONVERSION_SITES.find(candidate => candidate.id === id);
		assert.equal(site?.file, file);
		assert.deepEqual(site?.conversions, [{ helper, policies: ['point'] }]);
	}
});
