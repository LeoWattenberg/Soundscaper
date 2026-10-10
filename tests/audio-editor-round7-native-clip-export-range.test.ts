/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const startFrame of [0, 48_000]) test(`native Title clip export uses its authored range at ${startFrame}`, async context => {
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
	await authoring.run('video-title');
	const clip = controller.project?.clips.find(candidate => (candidate as Readonly<Record<string, unknown>>).kind === 'generator');
	assert.ok(clip);
	controller.actions.clip.move(String(clip.id), null, startFrame);
	controller.actions.timeline.selectClip(String(clip.id));
	controller.actions.timeline.selectTrackStartToEnd();
	const healthy = structuredClone(controller.project!.selection);
	assert.equal(healthy.startFrame, startFrame);
	assert.equal(healthy.endFrame, startFrame + 240_000);
	controller.actions.timeline.clearSelection();
	const media = structuredClone(controller.project!.clips);
	const history = controller.getSnapshot().history;
	const runtime = createAudacityActionRuntime(controller, { productId: 'framescaper' });
	runtime.actions.io.exportClip(String(clip.id));
	assert.equal(controller.project!.selection.startFrame, healthy.startFrame);
	assert.equal(controller.project!.selection.endFrame, healthy.endFrame);
	assert.deepEqual(controller.project!.clips, media);
	assert.deepEqual(controller.getSnapshot().history, history);
});
