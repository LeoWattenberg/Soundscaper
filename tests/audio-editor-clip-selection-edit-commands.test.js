import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryEngine,
} from './helpers/audio-editor-controller-harness.js';

/**
 * Selecting a clip collapses the drawn time range onto frame zero, so every
 * command that acts on "the selection" has to read the selected clips too.
 * These exercise the commands that used to read the range alone and did
 * nothing at all once a clip was what the person had selected.
 */

async function editorWithTwoClips() {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'selection-source', name: 'selection.wav', storageKey: 'selection-source',
				mimeType: 'audio/wav', frameCount: 1_000, channelCount: 1,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'clip-left', sourceId: 'selection-source', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'clip-right', sourceId: 'selection-source', timelineStartFrame: 200,
				sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
			},
		}],
	});
	return { controller, trackId };
}

function clipRanges(controller, trackId) {
	const project = controller.getSnapshot().project;
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	return track.clipIds
		.map((clipId) => project.clips.find((clip) => clip.id === clipId))
		.map((clip) => [clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames]);
}

test('trim outside selection keeps the selected clips rather than the span they bracket', async () => {
	const { controller, trackId } = await editorWithTwoClips();
	try {
		controller.actions.timeline.selectClip('clip-left');
		controller.actions.timeline.selectClip('clip-right', { additive: true });

		controller.actions.edit.trimOutsideSelection();

		// The gap between the two selected clips was never selected, so the trim
		// keeps each of them and removes only what fell outside both.
		assert.deepEqual(clipRanges(controller, trackId), [[0, 100], [200, 300]]);
	} finally {
		await controller.dispose();
	}
});

test('trim outside selection still keeps only the drawn range', async () => {
	const { controller, trackId } = await editorWithTwoClips();
	try {
		controller.actions.timeline.setSelection(20, 60, { trackIds: [trackId] });

		controller.actions.edit.trimOutsideSelection();

		assert.deepEqual(clipRanges(controller, trackId), [[20, 60]]);
	} finally {
		await controller.dispose();
	}
});

test('set loop to selection loops the selected clip', async () => {
	const { controller } = await editorWithTwoClips();
	try {
		controller.actions.timeline.selectClip('clip-right');

		controller.actions.transport.loopToSelection();

		const loop = controller.getSnapshot().project.loop;
		assert.deepEqual(
			{ enabled: loop.enabled, startFrame: loop.startFrame, endFrame: loop.endFrame },
			{ enabled: true, startFrame: 200, endFrame: 300 },
		);
	} finally {
		await controller.dispose();
	}
});

test('skip to selection start and end follow the selected clip', async () => {
	const { controller } = await editorWithTwoClips();
	try {
		controller.actions.timeline.selectClip('clip-right');

		assert.equal(controller.actions.timeline.skipToSelectionStart(), 200);
		assert.equal(controller.actions.timeline.skipToSelectionEnd(), 300);

		controller.actions.timeline.selectClip(null);
		assert.equal(controller.actions.timeline.skipToSelectionStart(), null);
	} finally {
		await controller.dispose();
	}
});

test('split into new track lifts the drawn range onto a copy of its track', async () => {
	const { controller, trackId } = await editorWithTwoClips();
	try {
		controller.actions.timeline.setSelection(40, 80, { trackIds: [trackId] });

		controller.actions.edit.splitIntoNewTrack();

		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.tracks.length, 2);
		const added = snapshot.project.tracks.find((track) => track.id !== trackId);
		assert.deepEqual(clipRanges(controller, added.id), [[40, 80]]);
		assert.deepEqual(clipRanges(controller, trackId), [[0, 40], [80, 100], [200, 300]]);
	} finally {
		await controller.dispose();
	}
});

