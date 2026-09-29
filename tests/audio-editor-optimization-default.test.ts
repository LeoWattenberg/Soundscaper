/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Store = ReturnType<typeof createMemoryStore>;

function optimizationMode(controller: ReturnType<typeof createAudioEditorController>): string {
	const preferences = controller.getSnapshot().preferences as unknown as { performance: { optimizeFor: string } };
	return preferences.performance.optimizeFor;
}

async function controllerFor(desktop: boolean, store: Store = createMemoryStore()) {
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en',
		fileService: createAudioEditorFileService({ bridge: desktop ? {} : null }) as Options['fileService'],
		store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	await controller.ready;
	assert.equal(controller.getSnapshot().ready, true);
	return controller;
}

test('fresh desktop editor defaults Optimize for to Speed', async (context) => {
	const controller = await controllerFor(true);
	context.after(async () => { await controller.dispose(); });
	assert.equal(optimizationMode(controller), 'speed');
});

test('fresh browser editor keeps Memory as its optimization default', async (context) => {
	const controller = await controllerFor(false);
	context.after(async () => { await controller.dispose(); });
	assert.equal(optimizationMode(controller), 'memory');
});

test('desktop restores a saved Memory choice over its new default', async (context) => {
	const store = createMemoryStore();
	store.settings.set('soundscaper:audio-editor-preferences-v1', createAudioEditorPreferencesV1({
		performance: { optimizeFor: 'memory' },
	}));
	const controller = await controllerFor(true, store);
	context.after(async () => { await controller.dispose(); });
	assert.equal(optimizationMode(controller), 'memory');
});

test('desktop gives legacy saved preferences without an optimization choice the new Speed default', async (context) => {
	const store = createMemoryStore();
	const legacy = structuredClone(createAudioEditorPreferencesV1());
	Reflect.deleteProperty(legacy, 'performance');
	store.settings.set('soundscaper:audio-editor-preferences-v1', legacy);
	const controller = await controllerFor(true, store);
	context.after(async () => { await controller.dispose(); });
	assert.equal(optimizationMode(controller), 'speed');
});

test('desktop factory reset restores Speed', async (context) => {
	const controller = await controllerFor(true);
	context.after(async () => { await controller.dispose(); });
	await controller.actions.preferences.update({ performance: { optimizeFor: 'memory' } });
	assert.equal(optimizationMode(controller), 'memory');
	await controller.actions.preferences.revertFactorySettings();
	assert.equal(optimizationMode(controller), 'speed');
});
