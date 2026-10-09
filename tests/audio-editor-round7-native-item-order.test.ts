/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('published item navigation orders normal Titles by their native sequence positions', async context => {
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
	for (let index = 0; index < 3; index++) await authoring.run('video-title');
	const ids = controller.project?.clips.map(clip => String(clip.id)).sort();
	assert.ok(ids);
	assert.equal(ids.length, 3);
	// Place the three ordinary clips against creation identity so the oracle
	// verifies chronology independently of the allocator's random UUIDs.
	ids.forEach((id, index) => controller.actions.clip.move(id, null, (2 - index) * 48_000));
	const chronological = [...ids].reverse();
	assert.deepEqual(chronological.map(id => controller.project?.clips.find(clip => clip.id === id)?.sequenceStartFrame), [0, 30, 60]);
	controller.actions.timeline.selectClip(chronological[0]);
	const runtime = createAudacityActionRuntime(controller, { productId: 'framescaper' });
	context.after(() => runtime.dispose());
	assert.equal(runtime.actions.navigation.nextItem(), chronological[1]);
	assert.equal(controller.getSnapshot().selectedClipId, chronological[1]);
	assert.equal(runtime.actions.navigation.nextItem(), chronological[2]);
	assert.equal(runtime.actions.navigation.previousItem(), chronological[1]);
	assert.equal(runtime.actions.navigation.previousItem(), chronological[0]);
});
