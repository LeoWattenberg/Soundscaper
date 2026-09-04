/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';

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
const {
	AUDIO_EDITOR_DEFAULT_VIEWS,
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
} = await import('../src/common/editor/preferences.js');

const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
});

test('the default view preference accepts the three timeline displays and defaults older documents to waveform', () => {
	assert.deepEqual([...AUDIO_EDITOR_DEFAULT_VIEWS], ['waveform', 'spectrogram', 'multiview']);
	for (const defaultView of AUDIO_EDITOR_DEFAULT_VIEWS) {
		assert.equal(
			createAudioEditorPreferencesV1({ appearance: { defaultView } }).appearance.defaultView,
			defaultView,
		);
	}
	assert.throws(() => createAudioEditorPreferencesV1({ appearance: { defaultView: 'half-wave' } }), RangeError);
	const saved = createAudioEditorPreferencesV1({ appearance: { defaultView: 'spectrogram' } });
	delete saved.appearance.defaultView;
	assert.equal(loadAudioEditorPreferencesV1(saved).preferences.appearance.defaultView, 'waveform');
});

test('a stored default view is the view the session starts in', async () => {
	const store = createMemoryStore();
	store.settings.set(
		'soundscaper:audio-editor-preferences-v1',
		createAudioEditorPreferencesV1({ appearance: { defaultView: 'multiview' } }),
	);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
	});
	try {
		await controller.ready;
		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.preferences.appearance.defaultView, 'multiview');
		assert.equal(snapshot.timeline.view, 'multiview');
	} finally {
		await controller.dispose();
	}
});

test('changing the default view preference retunes the running session and is persisted', async () => {
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
	});
	try {
		await controller.ready;
		assert.equal(controller.getSnapshot().timeline.view, 'waveform');

		await controller.actions.preferences.setDefaultView('spectrogram');
		assert.equal(controller.getSnapshot().preferences.appearance.defaultView, 'spectrogram');
		assert.equal(controller.getSnapshot().timeline.view, 'spectrogram');
		assert.equal(
			store.settings.get('soundscaper:audio-editor-preferences-v1').appearance.defaultView,
			'spectrogram',
		);

		// A rejected value must leave both the stored preference and the view alone.
		assert.throws(() => controller.actions.preferences.setDefaultView('half-wave'), RangeError);
		assert.equal(controller.getSnapshot().timeline.view, 'spectrogram');
	} finally {
		await controller.dispose();
	}
});

function createMemoryEngine() {
	return {
		positionFrame: 0,
		loadProject() {},
		async applyProject() {},
		setSourceResolver() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		stop() {},
		seek(frame) { this.positionFrame = frame; return frame; },
		async getAudioContext() { return null; },
		async dispose() {},
	};
}
