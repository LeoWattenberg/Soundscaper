/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createCurrentAudioEditorProject } = await import('../src/common/editor/project-current.ts');
const { createProjectStore } = await import('../src/common/editor/storage.js');
const { createAudioEditorEngine } = await import('../src/common/editor/engine.js');

test('real controller composes every clip-selection navigation action', async () => {
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine,
		copy: {
			ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
			projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
			genericError: 'Error: {message}', unknownError: 'Unknown error',
		},
	});

	try {
		await controller.ready;
		await controller.actions.project.open(createProject());
		const timeline = controller.actions.timeline;
		timeline.setSelection(25, 25, { trackIds: ['audio-track'] });
		timeline.selectPreviousClipBoundaryToCursor();
		assert.deepEqual(selection(controller), [20, 25]);
		timeline.selectCursorToNextClipBoundary();
		assert.deepEqual(selection(controller), [20, 40]);

		timeline.setSelection(40, 50, { trackIds: ['audio-track'] });
		timeline.selectPreviousClip();
		assert.deepEqual(selection(controller), [10, 20]);
		assert.equal(controller.getSnapshot().selectedClipId, 'left-clip');
		timeline.selectNextClip();
		assert.deepEqual(selection(controller), [40, 50]);
		assert.equal(controller.getSnapshot().selectedClipId, 'right-clip');

		assert.equal(timeline.skipToSelectionStart(), 40);
		assert.equal(engine.getPositionFrames(), 40);
		assert.equal(timeline.skipToSelectionEnd(), 50);
		assert.equal(engine.getPositionFrames(), 50);
		timeline.selectNoTracks();
		assert.deepEqual(controller.getSnapshot().project?.selection?.trackIds, []);
		assert.equal(controller.getSnapshot().selectedTrackId, null);
	} finally {
		await controller.dispose();
	}
});

function createProject() {
	return createCurrentAudioEditorProject({
		id: 'clip-navigation-project',
		title: 'Clip navigation',
		now: '2026-08-12T00:00:00.000Z',
		sources: [{
			id: 'audio-source', name: 'audio.wav', mimeType: 'audio/wav', storageKey: 'audio-source',
			frameCount: 100, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'audio-track', name: 'Audio', clipIds: ['left-clip', 'right-clip'] }],
		clips: [
			clip('left-clip', 10, 10),
			clip('right-clip', 40, 10),
		],
	});
}

function clip(id: string, timelineStartFrame: number, durationFrames: number) {
	return {
		id, sourceId: 'audio-source', title: id, timelineStartFrame,
		sourceStartFrame: 0, sourceDurationFrames: durationFrames, durationFrames,
	};
}

function selection(controller: ReturnType<typeof createAudioEditorController>): [number, number] {
	const selected = controller.getSnapshot().project?.selection;
	assert.ok(selected, 'The controller has an active project selection.');
	const { startFrame, endFrame } = selected;
	assert.ok(typeof startFrame === 'number');
	assert.ok(typeof endFrame === 'number');
	return [startFrame, endFrame];
}
