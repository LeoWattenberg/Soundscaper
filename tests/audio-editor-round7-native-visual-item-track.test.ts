/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('contextual image movement reaches adjacent picture tracks and preserves its native clock through history', () => {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(project);
	history = runtime.executeCommand(history, { type: 'track/add', track: {
		id: 'lower-picture', name: 'Lower picture', type: 'video', sequenceId: project.primarySequenceId,
	} });
	const original = history.present;
	const originalTrack = original.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id));
	assert.ok(originalTrack);
	let nextId = 0;
	const service = createClipTransformService({
		lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip',
			track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as unknown as ClipTransformProject,
		getSelectedClipId: () => clip.id, editingBlocked: () => false,
		createId: prefix => `${prefix}-derived-${String(++nextId)}`, snapTimelineFrame: frame => Math.round(Number(frame)),
		activeSelection: () => null, commit: command => { history = runtime.executeCommand(history, command); },
	});
	const controller = {
		getSnapshot: () => ({ project: history.present as unknown as ControllerProject,
			selectedClipId: clip.id, timeline: { pixelsPerSecond: 100 } }),
		actions: {
			clip: { move: (id: string, trackId: string, frame: number, options?: Readonly<{ preserveTime: true }>) =>
				service.moveClips(id, trackId, frame, options), trim: () => null },
			edit: { commit: () => null }, labels: { update: () => null }, timeline: { setSelection: () => null },
			track: { moveUp: () => null, moveDown: () => null }, transport: { seek: () => null },
		},
	};
	applyAudacityItemNavigationAction('track-view-item-move-down', controller);
	assert.equal(history.present.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id))?.id, 'lower-picture');
	assert.deepEqual(history.present.clips, original.clips);
	assert.deepEqual(history.present.sources, original.sources);
	history = runtime.undo(history);
	assert.deepEqual(history.present.tracks, original.tracks);
	history = runtime.redo(history);
	assert.equal(history.present.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id))?.id, 'lower-picture');
	applyAudacityItemNavigationAction('track-view-item-move-up', controller);
	assert.equal(history.present.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id))?.id, originalTrack.id);
	assert.deepEqual(history.present.clips, original.clips);
});

test('published contextual Title movement uses the existing picture track destination', async context => {
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
	const clip = controller.project?.clips.at(-1);
	assert.ok(clip);
	const originalTrack = controller.project?.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)));
	assert.ok(originalTrack);
	controller.actions.timeline.selectClip(String(clip.id));
	controller.actions.clip.moveToNewTrack(String(clip.id), 0);
	const movedTrack = controller.project?.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)));
	assert.ok(movedTrack);
	assert.notEqual(movedTrack.id, originalTrack.id);
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	await runtime.actions.navigation.moveItemUp();
	assert.equal(controller.project?.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)))?.id, originalTrack.id);
	assert.deepEqual(controller.project?.clips.find(candidate => candidate.id === clip.id), clip);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)))?.id, movedTrack.id);
	controller.actions.edit.redo();
	assert.equal(controller.project?.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)))?.id, originalTrack.id);
});
