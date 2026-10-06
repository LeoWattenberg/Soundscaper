/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { trackHierarchyPlacement } from '../src/common/editor/track-hierarchy-placement.ts';

test('flat hierarchy placement retains a derived track’s non-primary sequence', () => {
	const project = { primarySequenceId: 'primary', sequences: [{ id: 'alternate',
		trackNodes: [{ kind: 'track', id: 'source', parentFolderId: null }] }] };
	assert.deepEqual(trackHierarchyPlacement(project, 'source', 1, false), { sequenceId: 'alternate' });
	assert.deepEqual(trackHierarchyPlacement(project, 'source', 1, true), {
		sequenceId: 'alternate', parentFolderId: null, parentIndex: 1,
	});
});

test('a flat video controller duplicates tracks without requiring folder authority', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const capabilities = controller.getSnapshot().capabilities;
	assert.ok(capabilities && typeof capabilities === 'object');
	assert.equal((capabilities as Readonly<Record<string, unknown>>).trackFolders, false);
	const sourceId = controller.actions.track.addVideo({ name: 'Flat video track' });
	assert.ok(sourceId);
	assert.throws(() => controller.actions.edit.commit({ type: 'track/add',
		track: { id: 'unsupported', name: 'Unsupported folder placement', type: 'video', clipIds: [] },
		parentFolderId: null }), /does not support trackFolders/u);
	controller.actions.track.duplicate(sourceId);
	const copiedId = controller.getSnapshot().selectedTrackId;
	assert.notEqual(copiedId, sourceId);
	assert.equal(controller.getSnapshot().project?.tracks?.filter(track => 'type' in track && track.type === 'video').length, 2);
	controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().project?.tracks?.some(track => track.id === copiedId), false);
	controller.actions.edit.redo();
	assert.equal(controller.getSnapshot().project?.tracks?.some(track => track.id === copiedId), true);
});

for (const selection of ['clip', 'range']) {
	test(`flat Framescaper lifts a ${selection} selection without folder authority`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
			store: createProjectStore({ indexedDB: null, preferOpfs: false }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const samples = new Float32Array(40_000).fill(0.2);
		await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([samples, samples],
			{ sampleRate: 48_000, bitDepth: 32, float: true }))], 'Stereo recording.wav', { type: 'audio/wav' })]);
		const clipId = controller.getSnapshot().selectedClipId!;
		const sourceId = controller.getSnapshot().selectedTrackId!;
		const clip = controller.getSnapshot().project?.clips?.find(item => item.id === clipId);
		assert.ok(clip && 'durationFrames' in clip);
		const duration = Number(clip.durationFrames);
		assert.ok(duration > 4);
		assert.throws(() => { void controller.actions.track.splitStereoLR(sourceId); }, /does not support audioEffects/u);
		controller.actions.timeline.selectClip(clipId);
		if (selection === 'range') controller.actions.timeline.setSelection(Math.floor(duration / 4), Math.floor(duration * 3 / 4), { trackIds: [sourceId] });
		else controller.actions.transport.seek(Math.floor(duration / 2));
		controller.actions.edit.splitIntoNewTrack();
		const copyId = controller.getSnapshot().selectedTrackId;
		assert.ok(copyId);
		assert.notEqual(copyId, sourceId);
		assert.equal(controller.getSnapshot().project?.tracks?.some(track => track.id === copyId), true);
		controller.actions.edit.undo();
		assert.equal(controller.getSnapshot().project?.tracks?.some(track => track.id === copyId), false);
		controller.actions.edit.redo();
		assert.equal(controller.getSnapshot().project?.tracks?.some(track => track.id === copyId), true);
	});
}

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
