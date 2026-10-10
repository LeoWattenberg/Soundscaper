/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createClipSelectionNavigationService, type ClipSelectionNavigationProject } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';

test('the published Skip actions resolve selected native Title geometry without a drawn range', async context => {
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
	const clip = controller.project?.clips.find(candidate => candidate.kind === 'generator');
	assert.ok(clip);
	const clipId = String(clip.id);
	controller.actions.clip.move(clipId, null, 48_000);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.selectTrackStartToEnd();
	assert.equal(controller.actions.timeline.skipToSelectionStart(), 48_000);
	assert.equal(controller.actions.timeline.skipToSelectionEnd(), 288_000);
	controller.actions.timeline.clearSelection();
	controller.actions.transport.seek(0);
	controller.actions.timeline.selectClip(clipId);
	assert.equal(controller.project?.selection.startFrame, controller.project?.selection.endFrame);
	assert.deepEqual(controller.project?.selection.clipIds, [clipId]);
	const authored = structuredClone(controller.project);
	const history = controller.getSnapshot().history;
	assert.equal(controller.actions.timeline.skipToSelectionStart(), 48_000);
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 48_000);
	assert.equal(controller.actions.timeline.skipToSelectionEnd(), 288_000);
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 288_000);
	assert.deepEqual(controller.project, authored);
	assert.deepEqual(controller.getSnapshot().history, history);
});

test('Skip resolves disjoint native visual edges on their absolute NTSC grid', () => {
	for (const kind of ['image', 'still', 'generator', 'video']) {
		const project: ClipSelectionNavigationProject = {
			sampleRate: 48_000, primarySequenceId: 'main',
			sequences: [{ id: 'main', rate: { num: 30_000, den: 1001 } }],
			clips: [{ id: 'first', kind, sequenceId: 'main', sequenceStartFrame: 3, sequenceFrameCount: 3 },
				{ id: 'last', kind, sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 3 }],
			tracks: [{ id: 'pictures', type: 'video', clipIds: ['first', 'last'] }],
			selection: { startFrame: 0, endFrame: 0, clipIds: ['first', 'last'] },
		};
		const seeks: number[] = [];
		const service = createClipSelectionNavigationService({ getProject: () => project,
			state: { selectedClipId: 'first', selectedTrackId: 'pictures', selectedAnnotationId: null },
			updateSelection: () => assert.fail('Skip must not publish a selection'),
			seek: frame => { seeks.push(frame); } });
		assert.equal(service.skipToSelectionStart(), 4805, kind);
		assert.equal(service.skipToSelectionEnd(), 52_853, kind);
		assert.deepEqual(seeks, [4805, 52_853]);
	}
});

test('Skip honors a selected musical clip rather than its stale sample cache', () => {
	const project: ClipSelectionNavigationProject = { sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		clips: [{ id: 'music', kind: 'audio', anchor: 'musical', musicalStartBeat: { num: 2, den: 1 },
			musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 }, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, timelineStartFrame: 7, durationFrames: 11 }],
		tracks: [{ id: 'sound', type: 'audio', clipIds: ['music'] }],
		selection: { startFrame: 0, endFrame: 0, clipIds: ['music'] } };
	const service = createClipSelectionNavigationService({ getProject: () => project,
		state: { selectedClipId: 'music', selectedTrackId: 'sound', selectedAnnotationId: null },
		updateSelection: () => assert.fail('Skip must not publish a selection'), seek: () => {} });
	assert.equal(service.skipToSelectionStart(), 48_000);
	assert.equal(service.skipToSelectionEnd(), 72_000);
});
