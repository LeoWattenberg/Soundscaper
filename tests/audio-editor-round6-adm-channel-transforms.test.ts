/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels,
	setAdmEditorAssignment, setAdmEditorObject } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine,
	createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const operation of ['split', 'merge'] as const) for (const objects of [false, true]) {
	test(`${operation} relocates authored ADM ${objects ? 'bed and positioned object' : 'bed'} channels in one history entry`, async context => {
		const controller = makeController(`${operation}-${String(objects)}`);
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', { amplitude: .25, channelCount: operation === 'split' ? 2 : 1,
			durationSeconds: .1, frequency: 440 });
		const trackId = controller.getSnapshot().selectedTrackId!;
		let rightId = trackId;
		if (operation === 'merge') {
			controller.actions.track.add({ name: 'Right recording' });
			await controller.actions.generators.generate('tone', { amplitude: .15, channelCount: 1,
				durationSeconds: .1, frequency: 550 });
			rightId = controller.getSnapshot().selectedTrackId!;
		}
		let adm = createDefaultAdmMetadata(controller.getSnapshot().project, 'stereo');
		if (operation === 'merge') adm = setAdmEditorAssignment(adm, {
			stripKind: 'track', stripId: rightId, sourceChannel: 0, bedChannel: 'R', gain: .8,
		});
		if (objects) {
			const channel = listAdmEditorSourceChannels(controller.getSnapshot().project)
				.find(candidate => candidate.stripId === rightId && candidate.sourceChannel === (operation === 'split' ? 1 : 0));
			assert.ok(channel);
			adm = setAdmEditorObject(addAdmEditorObject(adm, channel, () => 'positioned-recording'), 'positioned-recording', {
				name: 'Right spot', gain: .6, position: { azimuth: -35, elevation: 15, distance: .7 },
			});
		}
		controller.actions.metadata.update({ adm });
		const before = controller.getSnapshot();
		const original = before.project as unknown as SoundscaperProject;
		assert.deepEqual(validateAdmAuthoredRouting(original.metadata.adm, original as unknown as RoutingProject), []);
		let expectedRightId = trackId;
		if (operation === 'split') {
			const split = await controller.actions.track.splitStereoLR(trackId);
			assert.ok(split);
			expectedRightId = split.rightTrackId;
		} else await controller.actions.track.makeStereo(trackId, rightId);
		const after = controller.getSnapshot();
		const changed = after.project as unknown as SoundscaperProject;
		assert.ok(changed.metadata.adm?.mode === 'authored');
		const expectedChannel = operation === 'split' ? 0 : 1;
		assert.deepEqual(changed.metadata.adm.bed.assignments, adm.bed.assignments.map(assignment =>
			assignment.stripId === rightId && assignment.sourceChannel === (operation === 'split' ? 1 : 0)
				? { ...assignment, stripId: expectedRightId, sourceChannel: expectedChannel } : assignment));
		assert.deepEqual(changed.metadata.adm.objects ?? [], (adm.objects ?? []).map(object => ({
			...object, stripId: expectedRightId, sourceChannel: expectedChannel,
		})));
		assert.deepEqual(validateAdmAuthoredRouting(changed.metadata.adm, changed as unknown as RoutingProject), []);
		assert.deepEqual(changed.metadata.adm.programme, adm.programme);
		assert.deepEqual(changed.metadata.adm.content, adm.content);
		assert.equal(changed.masterChannels, original.masterChannels);
		assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.metadata, original.metadata);
		assert.deepEqual(controller.getSnapshot().project!.clips, original.clips);
		assert.deepEqual(controller.getSnapshot().project!.tracks, original.tracks);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.metadata, changed.metadata);
		assert.deepEqual(controller.getSnapshot().project!.clips, changed.clips);
		assert.deepEqual(controller.getSnapshot().project!.tracks, changed.tracks);
	});
}

test('a deliberately unassigned stereo channel stays an authored draft after Split', async context => {
	const controller = makeController('unassigned');
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .25, channelCount: 2, durationSeconds: .1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId!;
	const adm = setAdmEditorAssignment(createDefaultAdmMetadata(controller.getSnapshot().project, 'stereo'), {
		stripKind: 'track', stripId: trackId, sourceChannel: 1, bedChannel: null, gain: 1,
	});
	controller.actions.metadata.update({ adm });
	const split = await controller.actions.track.splitStereoLR(trackId);
	assert.ok(split);
	const changed = controller.getSnapshot().project as unknown as SoundscaperProject;
	assert.deepEqual(changed.metadata.adm, adm);
	assert.deepEqual(validateAdmAuthoredRouting(changed.metadata.adm, changed as unknown as RoutingProject)
		.map(issue => issue.code), ['missing-terminal-strip', 'missing-bed-channel']);
});

function makeController(name: string) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	return createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r6-adm-channel-transform-${name}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
}
