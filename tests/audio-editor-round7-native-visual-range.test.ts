/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const action of ['contractSelectionRight', 'selectAllTracks'] as const) test(`selected native Title preserves its range through ${action}`, async context => {
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
	const clipId = String(clip.id);
	controller.actions.clip.move(clipId, null, 48_000);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.selectTrackStartToEnd();
	controller.actions.timeline[action]();
	const healthy = structuredClone(controller.project!.selection);
	assert.equal(healthy.startFrame, 48_000);
	assert.ok(healthy.endFrame > 48_000 && healthy.endFrame <= 288_000);
	controller.actions.timeline.clearSelection();
	controller.actions.transport.seek(0);
	controller.actions.timeline.selectClip(clipId);
	assert.equal(controller.project!.selection.startFrame, controller.project!.selection.endFrame);
	assert.deepEqual(controller.project!.selection.clipIds, [clipId]);
	const media = structuredClone(controller.project!.clips);
	const history = controller.getSnapshot().history;
	controller.actions.timeline[action]();
	assert.equal(controller.project!.selection.startFrame, healthy.startFrame);
	assert.equal(controller.project!.selection.endFrame, healthy.endFrame);
	assert.deepEqual(controller.project!.selection.clipIds, []);
	assert.deepEqual(controller.project!.selection.trackIds, action === 'selectAllTracks'
		? controller.project!.tracks.map(track => track.id)
		: [controller.project!.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clipId))!.id]);
	assert.deepEqual(controller.project!.clips, media);
	assert.deepEqual(controller.getSnapshot().history, history);
});
