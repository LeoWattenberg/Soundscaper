/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const selected of [['remove-a'], ['remove-a', 'remove-b']]) {
	test(`RemoveTracks removes ${String(selected.length)} selected native tracks as one Undo`, async context => {
		const controller = await fixture(context);
		controller.actions.timeline.selectTrack('keep');
		controller.actions.timeline.setSelection(0, 0, { trackIds: selected });
		const before = controller.getSnapshot();
		assert.ok(validateSoundscaperProject(before.project));
		assert.equal(await controller.actions.macros.run({ name: 'Remove selected',
			effects: [createMacroCommandStep('RemoveTracks')] }), true);
		const after = controller.getSnapshot();
		assert.ok(validateSoundscaperProject(after.project));
		assert.deepEqual(after.project.tracks.map(track => track.id),
			before.project.tracks.filter(track => !selected.includes(track.id)).map(track => track.id));
		assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
		const entry = after.history.undoEntries[0];
		assert.ok(entry && typeof entry === 'object' && 'type' in entry);
		assert.equal(entry.type, 'macro/run');
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, before.project.tracks);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, after.project.tracks);
	});
}

test('RemoveTracks uses the current focused native track when no explicit track range remains', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.selectTrack('remove-b');
	controller.actions.timeline.clearSelection();
	assert.equal(controller.getSnapshot().selectedTrackId, 'remove-b');
	await controller.actions.macros.run({ effects: [createMacroCommandStep('RemoveTracks')] });
	const after = controller.getSnapshot();
	assert.ok(validateSoundscaperProject(after.project));
	assert.deepEqual(after.project.tracks.map(track => track.id), ['keep', 'remove-a']);
});

test('RemoveTracks after ordinary No tracks does not remove a previous focus', async context => {
	const controller = await fixture(context);
	controller.actions.timeline.selectTrack('remove-b');
	controller.actions.timeline.selectNoTracks();
	const before = controller.getSnapshot();
	await controller.actions.macros.run({ effects: [createMacroCommandStep('RemoveTracks')] });
	assert.deepEqual(controller.getSnapshot().project!.tracks, before.project!.tracks);
	assert.equal(controller.getSnapshot().history.undoEntries.length, before.history.undoEntries.length);
});

test('a locked target refuses the complete RemoveTracks macro before any earlier selected track is removed', async context => {
	const controller = await fixture(context);
	controller.actions.track.update('remove-b', { locked: true });
	controller.actions.timeline.setSelection(0, 0, { trackIds: ['remove-a', 'remove-b'] });
	const before = controller.getSnapshot();
	await assert.rejects(() => controller.actions.macros.run({
		effects: [createMacroCommandStep('RemoveTracks')],
	}), /locked/iu);
	assert.deepEqual(controller.getSnapshot().project!.tracks, before.project!.tracks);
	assert.equal(controller.getSnapshot().history.undoEntries.length, before.history.undoEntries.length);
});

async function fixture(context: test.TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const project = createSoundscaperProject({ id: context.name, tracks: ['keep', 'remove-a', 'remove-b']
		.map(id => createAudioTrack({ id, name: id })) });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store, projectRuntime, sessionController: projectRuntime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	return controller;
}
