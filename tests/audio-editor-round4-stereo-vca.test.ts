/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('stereo replacement restores source VCA memberships after structural pruning, in one Undo', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round4-stereo-vca' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 2, durationSeconds: 0.1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId!;
	const graph = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph, mixer: { ...graph, vcas: [
		{ id: 'fader', name: 'Shared VCA', gain: 0.5, mute: false, members: [{ kind: 'track', id: trackId }, { kind: 'master' }] },
		{ id: 'master-only', name: 'Other VCA', gain: 0.75, mute: true, members: [{ kind: 'master' }] },
	] } });
	const before = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	const split = await controller.actions.track.splitStereoLR(trackId);
	assert.ok(split);
	const after = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	assert.deepEqual(after.vcas[0], { ...before.vcas[0], members: [{ kind: 'master' },
		{ kind: 'track', id: split.leftTrackId }, { kind: 'track', id: split.rightTrackId }] });
	assert.deepEqual(after.vcas[1], before.vcas[1]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, before);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, after);
});
