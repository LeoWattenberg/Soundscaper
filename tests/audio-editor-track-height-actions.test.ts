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

const MINIMUM_TRACK_HEIGHT = 40;
const DEFAULT_TRACK_HEIGHT = 114;

test('Audacity collapse and expand all tracks set absolute heights, unlike the relative step commands', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: {
			ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
			projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
			genericError: 'Error: {message}', unknownError: 'Unknown error',
		},
	});

	try {
		await controller.ready;
		await controller.actions.project.open(createProject());
		const heights = () => controller.getSnapshot().project.tracks.map((track: { height: number }) => track.height);
		assert.deepEqual(heights(), [80, 200], 'the fixture starts with two differing track heights');

		controller.actions.track.collapseAllHeights();
		assert.deepEqual(
			heights(),
			[MINIMUM_TRACK_HEIGHT, MINIMUM_TRACK_HEIGHT],
			'collapse pins every track to the minimum height rather than stepping down',
		);

		controller.actions.track.expandAllHeights();
		assert.deepEqual(
			heights(),
			[DEFAULT_TRACK_HEIGHT, DEFAULT_TRACK_HEIGHT],
			'expand pins every track to the default height rather than stepping up',
		);

		controller.actions.track.decreaseAllHeights();
		assert.deepEqual(
			heights(),
			[DEFAULT_TRACK_HEIGHT - 16, DEFAULT_TRACK_HEIGHT - 16],
			'the relative step commands keep working alongside the absolute ones',
		);
	} finally {
		await controller.dispose();
	}
});

function createProject() {
	return createCurrentAudioEditorProject({
		id: 'track-height-project',
		title: 'Track heights',
		now: '2026-09-02T00:00:00.000Z',
		sources: [{
			id: 'audio-source', name: 'audio.wav', mimeType: 'audio/wav', storageKey: 'audio-source',
			frameCount: 100, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 65_536,
		}],
		tracks: [
			{ type: 'audio', id: 'short-track', name: 'Short', height: 80, clipIds: [] },
			{ type: 'audio', id: 'tall-track', name: 'Tall', height: 200, clipIds: [] },
		],
		clips: [],
	});
}

function createMemoryEngine() {
	return {
		positionFrame: 0,
		loadProject() {},
		async applyProject() {},
		setSourceResolver() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		stop() {},
		seek(frame: number) { this.positionFrame = frame; return frame; },
		async getAudioContext() { return null; },
		async dispose() {},
	};
}

function createMemoryTimePitchCache() {
	return {
		createEngineSourceResolver() { return null; },
		retainClipIds() {},
		getProtectedSourceIds() { return new Set<string>(); },
		dispose() {},
	};
}
