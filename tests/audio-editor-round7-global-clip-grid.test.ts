/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

void test('global clip item movement reaches successive snap boundaries and preserves exact Undo', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round7-global-clip-grid' }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .4, channelCount: 1, durationSeconds: 2, frequency: 440,
	});
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	const actionController = {
		getSnapshot: () => {
			const snapshot = controller.getSnapshot();
			return { project: snapshot.project as unknown as ControllerProject,
				selectedClipId: snapshot.selectedClipId, selectedTrackId: snapshot.selectedTrackId,
				timeline: { pixelsPerSecond: 120 } };
		},
		actions: {
			clip: { move: controller.actions.clip.move, trim: controller.actions.clip.trim },
			edit: { commit: controller.actions.edit.commit }, labels: { update: controller.actions.labels.update },
			timeline: { setSelection: controller.actions.timeline.setSelection },
			track: { moveUp: controller.actions.track.moveUp, moveDown: controller.actions.track.moveDown },
			transport: { seek: controller.actions.transport.seek },
		},
	};
	const position = () => {
		const clip = controller.getSnapshot().project?.clips?.find(candidate => candidate.id === clipId);
		assert.ok(clip && 'timelineStartFrame' in clip);
		return clip.timelineStartFrame;
	};
	applyAudacityItemNavigationAction('track-view-item-move-right', actionController);
	assert.equal(position(), 48_000);
	applyAudacityItemNavigationAction('track-view-item-move-right', actionController);
	assert.equal(position(), 96_000);
	applyAudacityItemNavigationAction('track-view-item-move-left', actionController);
	assert.equal(position(), 48_000);
	controller.actions.edit.undo();
	assert.equal(position(), 96_000);
	controller.actions.edit.redo();
	assert.equal(position(), 48_000);
});

void test('global vertical clip movement preserves off-grid time while snapping is enabled', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round7-global-clip-grid-vertical' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .4, channelCount: 1, durationSeconds: 2, frequency: 440,
	});
	const originalTrack = controller.getSnapshot().selectedTrackId;
	assert.ok(originalTrack);
	controller.actions.clip.move(clipId, originalTrack, 12_000);
	const destination = controller.actions.track.add({ name: 'Destination' });
	assert.ok(destination);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	applyAudacityItemNavigationAction('track-view-item-move-down', {
		getSnapshot: () => ({ project: controller.getSnapshot().project as unknown as ControllerProject,
			selectedClipId: clipId, timeline: { pixelsPerSecond: 120 } }),
		actions: {
			clip: { move: controller.actions.clip.move, trim: controller.actions.clip.trim },
			edit: { commit: controller.actions.edit.commit }, labels: { update: controller.actions.labels.update },
			timeline: { setSelection: controller.actions.timeline.setSelection },
			track: { moveUp: controller.actions.track.moveUp, moveDown: controller.actions.track.moveDown },
			transport: { seek: controller.actions.transport.seek },
		},
	});
	const project = controller.getSnapshot().project;
	const clip = project?.clips?.find(candidate => candidate.id === clipId);
	assert.ok(clip && 'timelineStartFrame' in clip);
	assert.equal(clip.timelineStartFrame, 12_000);
	const destinationTrack = project?.tracks?.find(track => track.id === destination);
	assert.ok(destinationTrack && 'clipIds' in destinationTrack);
	assert.ok(Array.isArray(destinationTrack.clipIds) && destinationTrack.clipIds.includes(clipId));
	controller.actions.edit.undo();
	const restoredTrack = controller.getSnapshot().project?.tracks?.find(track => track.id === originalTrack);
	assert.ok(restoredTrack && 'clipIds' in restoredTrack);
	assert.ok(Array.isArray(restoredTrack.clipIds) && restoredTrack.clipIds.includes(clipId));
});
