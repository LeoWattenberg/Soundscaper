/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const subject of ['audio', 'video', 'linked pair'] as const) {
	for (const mode of ['header', 'range'] as const) test(`Duplicate ${subject} with ${mode} selection preserves complete media lane pairs`, async context => {
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
			storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
				persisted: async () => true, persist: async () => true } as unknown as StorageManager,
		} });
		const options = framescaperBaselineOptions();
		assert.ok(Array.isArray(options.tracks)); assert.ok(Array.isArray(options.clips));
		const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...options,
			tracks: (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, laneGroupId: 'camera-lanes' })),
			clips: (options.clips as Record<string, unknown>[]).map(clip => ({ ...clip, avLinkId: 'camera-link' })) });
		assert.ok(await environment.createProjectIfAbsent(project));
		const controller = createFramescaperAudioEditorController(environment);
		context.after(async () => { await controller.dispose(); await environment.close(); });
		await controller.ready;
		await controller.actions.project.openById(project.id);
		const clipId = subject === 'video' ? 'video-clip' : 'audio-clip';
		controller.actions.timeline.selectClip(clipId);
		if (subject !== 'linked pair') controller.actions.video.unlink(clipId);
		controller.actions.timeline.selectClip(clipId);
		if (mode === 'range') controller.actions.timeline.setSelection(0, 48_000, {
			trackIds: subject === 'linked pair' ? ['video-track', 'audio-track'] : [`${subject}-track`],
		});
		const before = controller.project!;
		const undoCount = controller.getSnapshot().history.undoEntries.length;
		controller.actions.edit.duplicate();
		const after = controller.project!;
		const originalIds = new Set(before.tracks.map(track => track.id));
		const copies = after.tracks.filter(track => !originalIds.has(track.id));
		assert.equal(copies.length, subject === 'linked pair' ? 2 : 1);
		if (subject === 'linked pair') {
			assert.ok(copies[0]?.laneGroupId);
			assert.notEqual(copies[0].laneGroupId, 'camera-lanes');
			assert.equal(copies[1]?.laneGroupId, copies[0].laneGroupId);
			assert.deepEqual(copies.map(track => track.type), ['video', 'audio']);
		} else assert.equal(copies[0]?.laneGroupId, null);
		assert.deepEqual(after.tracks.filter(track => originalIds.has(track.id)), before.tracks);
		assert.equal(after.clips.length, before.clips.length + copies.length);
		assert.deepEqual(after.sources, before.sources);
		assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project!.tracks, before.tracks);
		assert.deepEqual(controller.project!.clips, before.clips);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project!.tracks, after.tracks);
		assert.deepEqual(controller.project!.clips, after.clips);
	});
}
