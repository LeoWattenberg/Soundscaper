/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryEngine } from './helpers/mix-render-fixtures.js';

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

const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	projectDirty: 'Unsaved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
});

function openController(store) {
	return createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
}

test('the macro library survives a controller restart and reaches the document snapshot', async () => {
	const store = createMemoryStore();
	const controller = openController(store);
	await controller.ready;
	const saved = controller.actions.macros.library.save({
		name: 'Cleanup',
		effects: [{ type: 'audacity-invert' }],
	});
	assert.deepEqual(
		controller.getSnapshot().macros.library.map(({ id, name }) => ({ id, name })),
		[{ id: saved.id, name: 'Cleanup' }],
	);
	controller.actions.macros.library.save({ ...saved, name: 'Cleanup v2' });
	await controller.actions.macros.library.flush();
	assert.deepEqual(
		store.settings.get('audio-editor-effect-macros-v1').macros.map(({ name }) => name),
		['Cleanup v2'],
	);
	await controller.dispose();

	const reopened = openController(store);
	await reopened.ready;
	assert.deepEqual(
		reopened.getSnapshot().macros.library.map(({ name }) => name),
		['Cleanup v2'],
		'a saved macro must still be there the next time the manager opens',
	);
	assert.equal(reopened.actions.macros.library.delete(saved.id), true);
	await reopened.actions.macros.library.flush();
	assert.deepEqual(store.settings.get('audio-editor-effect-macros-v1').macros, []);
	await reopened.dispose();
});
