/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { FOUNDATION_TIME_CONVERSION_SITES } from '../src/common/editor/foundation-time-conversion-audit.ts';

test('generated visual movement owns its nearest sequence-frame policy', () => {
	assert.deepEqual(FOUNDATION_TIME_CONVERSION_SITES.find(site => site.id === 'framescaper-generated-visual-move-placement'), {
		id: 'framescaper-generated-visual-move-placement',
		file: 'src/framescaper/editor-timeline-visual-move-command.ts',
		behavior: 'Ordinary generator and still moves resolve the requested project sample position once to the nearest destination sequence frame, retaining their authored extent, source clock and exact owner through the existing visual mutation command.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	});
});

for (const destination of ['existing', 'new']) test(`a public generated Title moves to an ${destination} picture track with one Undo`, async context => {
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
	const project = controller.project;
	assert.ok(project);
	const clip = project.clips.at(-1);
	assert.ok(clip);
	controller.actions.timeline.selectClip(String(clip.id));
	const original = structuredClone(controller.project);
	const originalHistory = controller.getSnapshot().history.undoEntries.length;
	if (destination === 'new') controller.actions.clip.moveToNewTrack(String(clip.id), 48_000);
	else controller.actions.clip.move(String(clip.id), null, 48_000);
	const after = controller.project;
	assert.ok(after);
	const moved = after.clips.find(candidate => candidate.id === clip.id);
	assert.deepEqual(moved, { ...clip, sequenceStartFrame: 30 });
	assert.deepEqual(after.sources, original?.sources);
	assert.equal(after.tracks.length, project.tracks.length + (destination === 'new' ? 1 : 0));
	assert.equal(controller.getSnapshot().history.undoEntries.length, originalHistory + 1);
	const owner = after.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(String(clip.id)));
	assert.ok(owner);
	assert.equal(owner.type, 'video');
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, original?.clips);
	assert.deepEqual(controller.project?.tracks, original?.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
