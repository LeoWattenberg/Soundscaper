/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { isProductVisualClip } from '../src/common/editor/video-timeline-internals.js';
import { selectedTrackContentRange } from '../src/common/editor/controller/track-audio/internal/selected-track-content-range.ts';
import type { SelectionViewProject } from '../src/common/editor/controller/track-audio/internal/selection-view-service-types.d.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('the public generated Title track range ends at its real content and leaves the playhead contract intact', async context => {
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
	const project = controller.project;
	assert.ok(project);
	const clip = project.clips.find(candidate => isProductVisualClip(candidate));
	assert.ok(clip);
	controller.actions.timeline.selectClip(String(clip.id));
	const history = controller.getSnapshot().history;
	controller.actions.timeline.selectTrackStartToEnd();
	assert.equal(controller.project?.selection.startFrame, 0);
	assert.equal(controller.project?.selection.endFrame, 240_000);
	assert.deepEqual(controller.getSnapshot().history, history, 'selection is not an authored undo entry');
	controller.actions.timeline.skipToSelectionEnd();
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 240_000);
});

test('selected mixed content resolves absolute NTSC boundaries and excludes other tracks', () => {
	const project: SelectionViewProject = {
		id: 'selection', schemaVersion: 20, sampleRate: 48_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30_000, den: 1001 } }],
		selection: { startFrame: 0, endFrame: 0 }, tracks: [
			{ id: 'pictures', type: 'video', clipIds: ['poster', 'title'] },
			{ id: 'sound', type: 'audio', clipIds: ['recording'] },
			{ id: 'other', type: 'video', clipIds: ['elsewhere'] },
		], clips: [
			{ id: 'poster', kind: 'image', sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 150 },
			{ id: 'title', kind: 'generator', sequenceId: 'main', sequenceStartFrame: 180, sequenceFrameCount: 30 },
			{ id: 'recording', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'elsewhere', kind: 'video', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 900 },
		],
	};
	const before = structuredClone(project);
	const noFallback = () => { assert.fail('selected native content has its own extent'); };
	assert.deepEqual(selectedTrackContentRange(project, ['pictures'], noFallback), { startFrame: 48_048, endFrame: 336_336 });
	assert.deepEqual(selectedTrackContentRange(project, ['pictures', 'sound'], noFallback), { startFrame: 0, endFrame: 336_336 });
	assert.deepEqual(project, before);
});

test('empty and missing tracks retain their established range admission', () => {
	const project: SelectionViewProject = { id: 'empty', schemaVersion: 20, sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0 }, clips: [], tracks: [{ id: 'empty-track', type: 'audio', clipIds: [] }] };
	let fallbacks = 0;
	const fallback = () => { fallbacks += 1; return 1_440_000; };
	assert.equal(selectedTrackContentRange(project, ['missing'], fallback), null);
	assert.equal(fallbacks, 0);
	assert.deepEqual(selectedTrackContentRange(project, ['empty-track'], fallback), { startFrame: 0, endFrame: 1_440_000 });
	assert.equal(fallbacks, 1);
});
