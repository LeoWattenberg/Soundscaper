/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

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
