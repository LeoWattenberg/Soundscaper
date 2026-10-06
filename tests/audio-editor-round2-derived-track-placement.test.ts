/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';

test('duplicated tracks retain their source folder and follow their source among siblings', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	const sourceId = controller.getSnapshot().selectedTrackId!;
	const siblingId = controller.actions.track.add({ name: 'Other child' });
	const folderId = controller.actions.trackFolders.wrapSelection([sourceId, siblingId!]);
	assert.ok(folderId);
	controller.actions.track.duplicate(sourceId);
	const copyId = controller.getSnapshot().selectedTrackId!;
	const rows = createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows;
	assert.equal(rows.find(row => row.id === copyId)?.parentFolderId, folderId);
	assert.deepEqual(rows.filter(row => row.parentFolderId === folderId).map(row => row.id),
		[sourceId, copyId, siblingId]);
	controller.actions.edit.undo();
	assert.equal(createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
		.some(row => row.id === copyId), false);
	controller.actions.edit.redo();
	assert.equal(createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
		.find(row => row.id === copyId)?.parentFolderId, folderId);
});

for (const selection of ['clip', 'range']) {
	test(`Split into new track retains the folder for a ${selection} selection`, async (context) => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			store: createProjectStore({ indexedDB: null, preferOpfs: false }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
			durationSeconds: 0.8, frequency: 440 });
		const clipId = controller.getSnapshot().selectedClipId!;
		const sourceId = controller.getSnapshot().selectedTrackId!;
		const folderId = controller.actions.trackFolders.wrapSelection([sourceId]);
		controller.actions.timeline.selectClip(clipId);
		if (selection === 'range') controller.actions.timeline.setSelection(10_000, 30_000, { trackIds: [sourceId] });
		else controller.actions.transport.seek(20_000);
		controller.actions.edit.splitIntoNewTrack();
		const copyId = controller.getSnapshot().selectedTrackId!;
		assert.notEqual(copyId, sourceId);
		const rows = createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows;
		assert.equal(rows.find(row => row.id === copyId)?.parentFolderId, folderId);
		assert.deepEqual(rows.filter(row => row.parentFolderId === folderId).map(row => row.id), [sourceId, copyId]);
		controller.actions.edit.undo();
		assert.equal(createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
			.some(row => row.id === copyId), false);
		controller.actions.edit.redo();
		assert.equal(createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
			.find(row => row.id === copyId)?.parentFolderId, folderId);
	});
}
