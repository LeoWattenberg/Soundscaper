/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createDefaultAdmMetadata, setAdmEditorAssignment } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('an ordinary split retains the ADM reference whose original track identity survives the atomic replacement', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'r6-adm-track-replacement' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .4, channelCount: 2, durationSeconds: .1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId;
	assert.equal(typeof trackId, 'string');
	if (typeof trackId !== 'string') throw new Error('Missing normal generated stereo track.');
	const authored = setAdmEditorAssignment(createDefaultAdmMetadata(controller.getSnapshot().project, 'mono'), {
		stripKind: 'track', stripId: trackId, sourceChannel: 1, bedChannel: null, gain: 1,
	});
	controller.actions.metadata.update({ adm: authored });
	const before = controller.getSnapshot().project as unknown as SoundscaperProject;
	assert.deepEqual(validateAdmAuthoredRouting(before.metadata.adm, before as unknown as RoutingProject), []);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	const split = await controller.actions.track.splitStereoLR(trackId);
	assert.ok(split);
	assert.equal(split.leftTrackId, trackId);
	const after = controller.getSnapshot().project as unknown as SoundscaperProject;
	assert.deepEqual(after.metadata.adm, authored);
	assert.deepEqual(validateAdmAuthoredRouting(after.metadata.adm, after as unknown as RoutingProject)
		.map(issue => [issue.code, issue.stripId]), [['missing-terminal-strip', split.rightTrackId]],
		'the new right track remains an ordinary authored draft until the user assigns it');
	assert.equal(after.clips.length, 2);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.metadata, before.metadata);
	assert.deepEqual(controller.getSnapshot().project!.tracks, before.tracks);
	assert.deepEqual(controller.getSnapshot().project!.clips, before.clips);
	assert.deepEqual(controller.getSnapshot().project!.mixer, before.mixer);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.metadata, after.metadata);
	assert.deepEqual(controller.getSnapshot().project!.tracks, after.tracks);
	assert.deepEqual(controller.getSnapshot().project!.clips, after.clips);
	assert.deepEqual(controller.getSnapshot().project!.mixer, after.mixer);
	controller.actions.metadata.update({ adm: setAdmEditorAssignment(authored, {
		stripKind: 'track', stripId: split.rightTrackId, sourceChannel: 0, bedChannel: 'M', gain: 1,
	}) });
	const routed = controller.getSnapshot().project as unknown as SoundscaperProject;
	assert.deepEqual(validateAdmAuthoredRouting(routed.metadata.adm, routed as unknown as RoutingProject), []);
});
