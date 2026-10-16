/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const foldered of [false, true]) test(`native derived-track order accounts for ${foldered ? 'folder' : 'root'} placement`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round7-derived-placement-${foldered}` }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipIds: string[] = [], trackIds: string[] = [];
	for (let index = 0; index < 2; index += 1) {
		const trackId = controller.actions.track.add({ name: ['Alpha', 'Bravo'][index]! });
		assert.ok(trackId);
		controller.actions.timeline.selectTrack(trackId);
		await controller.actions.generators.generate('tone', { durationSeconds: .2, channelCount: 1,
			amplitude: .25, frequency: 440 });
		const clipId = controller.getSnapshot().selectedClipId;
		assert.ok(clipId);
		clipIds.push(clipId); trackIds.push(trackId);
	}
	if (foldered) controller.actions.trackFolders.wrapSelection(trackIds);
	const ordered = () => {
		const project = controller.getSnapshot().project!;
		const tracks = project.tracks ?? [];
		const names = new Map(tracks.map(track => [track.id, 'name' in track ? track.name : null]));
		return planTrackListRows(createDocumentTrackFolderSnapshot(project), tracks).entries
			.flatMap(row => row.kind === 'track' ? [names.get(row.trackId)] : []);
	};
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.timeline.setExactSelection(0, 9600, { trackIds: [trackIds[0]!] });
	controller.actions.edit.splitIntoNewTrack();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo']);
	controller.actions.edit.undo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.timeline.setExactSelection(0, 9600, { trackIds });
	controller.actions.edit.splitIntoNewTrack();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo', 'Bravo 2']);
	assert.equal(controller.getSnapshot().project!.clips?.length, 2);
	controller.actions.edit.undo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.edit.redo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo', 'Bravo 2']);
});
