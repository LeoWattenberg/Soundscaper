/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const criterion of ['name', 'time'] as const) test(`native Title tracks sort by ${criterion} with exact Undo and Redo`, async context => {
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
	await authoring.run('video-title');
	const secondClipId = String(controller.project!.clips.at(-1)!.id);
	controller.actions.timeline.selectClip(secondClipId);
	controller.actions.clip.moveToNewTrack(secondClipId, 0);
	const clips = controller.project?.clips.filter(clip => (clip as Readonly<Record<string, unknown>>).kind === 'generator');
	assert.equal(clips?.length, 2);
	const ids = clips!.map(clip => String(clip.id));
	const ownerIds = ids.map(id => controller.project!.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(id))!.id);
	assert.equal(new Set(ownerIds).size, 2);
	controller.actions.clip.move(ids[0], ownerIds[0], 48_000);
	assert.equal((controller.project!.clips.find(clip => clip.id === ids[0]) as Readonly<Record<string, unknown>>).sequenceStartFrame, 30);
	await controller.actions.track.update(ownerIds[0], { name: 'Zulu' });
	await controller.actions.track.update(ownerIds[1], { name: 'Alpha' });
	const order = () => controller.project!.tracks.filter(track => ownerIds.includes(track.id)).map(track => track.id);
	assert.deepEqual(order(), ownerIds);
	const media = structuredClone(controller.project?.clips);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	await (criterion === 'name' ? controller.actions.track.sortByName() : controller.actions.track.sortByTime());
	assert.deepEqual(order(), [ownerIds[1], ownerIds[0]]);
	assert.deepEqual(controller.project?.clips, media);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	await controller.actions.edit.undo();
	assert.deepEqual(order(), ownerIds);
	await controller.actions.edit.redo();
	assert.deepEqual(order(), [ownerIds[1], ownerIds[0]]);
	assert.deepEqual(controller.project?.clips, media);
});
