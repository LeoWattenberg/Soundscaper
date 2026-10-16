/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planMuteAllTracks } from '../src/common/editor/controller/track-audio/internal/track-mute-all-plan.ts';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('global mute plans include folder authority and skip labels and unchanged controls', () => {
	const project = { tracks: [{ id: 'audio', type: 'audio', mute: false },
		{ id: 'label', type: 'label', mute: false }, { id: 'video', type: 'video', mute: true, hidden: true }],
		trackFolders: [{ id: 'parent', mute: true }, { id: 'child', mute: false }] };
	assert.deepEqual(planMuteAllTracks(project, false), [
		{ type: 'track/update', trackId: 'video', changes: { hidden: false } },
		{ type: 'track-folder/update', folderId: 'parent', changes: { mute: false } },
	]);
	assert.deepEqual(planMuteAllTracks(project, true), [
		{ type: 'track/update', trackId: 'audio', changes: { mute: true } },
		{ type: 'track-folder/update', folderId: 'child', changes: { mute: true } },
	]);
});

test('Unmute all restores a muted folder with one Undo and Redo', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId!;
	const folderId = controller.actions.trackFolders.wrapSelection([trackId])!;
	controller.actions.trackFolders.update(folderId, { mute: true });
	controller.actions.track.unmuteAll();
	const muted = () => {
		const folder = createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
			.find(row => row.id === folderId)!;
		assert.equal(folder.kind, 'folder');
		return folder.kind === 'folder' ? folder.mute : null;
	};
	assert.equal(muted(), false);
	controller.actions.edit.undo();
	assert.equal(muted(), true);
	controller.actions.edit.redo();
	assert.equal(muted(), false);
});
