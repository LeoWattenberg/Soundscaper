/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('Next item enters the first ordinary item after Select none', async context => {
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
	for (let index = 0; index < 2; index++) await authoring.run('video-title');
	const ids = controller.project?.clips.map(clip => String(clip.id)).sort();
	assert.ok(ids);
	assert.equal(ids.length, 2);
	controller.actions.clip.move(ids[0], null, 0);
	controller.actions.clip.move(ids[1], null, 48_000);
	assert.deepEqual(ids.map(id => controller.project?.clips.find(clip => clip.id === id)?.sequenceStartFrame), [0, 30]);
	const runtime = createAudacityActionRuntime(controller, { productId: 'framescaper' });
	context.after(() => runtime.dispose());
	controller.actions.timeline.selectClip(ids[0]);
	assert.equal(await runtime.actions.navigation.nextItem(), ids[1], 'a selected anchor advances normally');
	controller.actions.timeline.clearSelection();
	assert.equal(controller.getSnapshot().selectedClipId, null);
	assert.deepEqual(controller.project?.selection.clipIds, []);
	assert.equal(await runtime.actions.navigation.nextItem(), ids[0], 'enter the list before advancing within it');
	assert.equal(controller.getSnapshot().selectedClipId, ids[0]);
});

test('Item below enters the first ordinary track after No tracks', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round7-item-entry' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const first = controller.project?.tracks[0]?.id;
	const second = controller.actions.track.add({ name: 'Second' });
	assert.ok(first && second);
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	controller.actions.timeline.selectTrack(first);
	assert.equal(runtime.actions.navigation.itemBelow(), second, 'a selected anchor advances normally');
	controller.actions.timeline.selectNoTracks();
	assert.equal(controller.getSnapshot().selectedTrackId, null);
	assert.equal(runtime.actions.navigation.itemBelow(), first, 'enter the list before advancing within it');
	controller.actions.timeline.selectNoTracks();
	assert.equal(runtime.actions.navigation.lastTrack(), second, 'explicit Last track still reaches the end');
});
