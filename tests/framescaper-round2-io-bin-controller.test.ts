/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

test('the real Framescaper public bin actions select an owned timeline image', async () => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(item => Array.isArray(item.clipIds) && item.clipIds.includes(fixture.clip.id));
	assert.ok(track);
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline', trackId: track.id }, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null,
		clip: fixture.clip, placement: { scope: 'timeline', trackId: track.id } }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = createFramescaperAudioEditorController(environment);
	try {
		await controller.ready;
		await controller.actions.project.openById(fixture.project.id);
		assert.deepEqual(controller.actions.projectBin.moveFromTimeline(fixture.clip.id), [fixture.clip.id]);
		const placed = controller.actions.projectBin.place(fixture.clip.id);
		assert.equal(typeof placed, 'string');
		assert.deepEqual(controller.actions.projectBin.selectInstances(fixture.clip.id), [placed]);
		assert.equal(controller.getSnapshot().selectedClipId, placed);
		assert.deepEqual(controller.project?.selection.clipIds, [placed]);
	} finally {
		await controller.dispose();
		await environment.close();
	}
});
