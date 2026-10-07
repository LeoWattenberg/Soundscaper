/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('public Make stereo preserves common mono output and sends in one Undo', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round4-stereo-routing' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 440 });
	const left = controller.getSnapshot().selectedTrackId!;
	controller.actions.track.add({ name: 'Right channel' });
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 550 });
	const right = controller.getSnapshot().selectedTrackId!;
	assert.notEqual(left, right);
	const groupId = controller.actions.mixer.addBus('group');
	const sendId = controller.actions.mixer.addBus('send');
	for (const id of [left, right]) controller.actions.mixer.setRoute(id, { groupId, sends: { [String(sendId)]: 0.5 } });
	const before = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.track.makeStereo(left, right);
	const after = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	const routes = after.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === left);
	assert.deepEqual(routes.map(({ kind, destination, level, position, channelMap }) => ({ kind, destination, level, position, channelMap })), [
		{ kind: 'assignment', destination: { kind: 'mixer-node', id: groupId }, level: 1, position: 'post-fader', channelMap: [0, 1] },
		{ kind: 'send', destination: { kind: 'mixer-node', id: sendId }, level: 0.5, position: 'post-fader', channelMap: [0, 1] },
	]);
	assert.equal(after.edges.some(edge => edge.source.kind === 'track' && edge.source.id === right), false);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, before);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, after);
});
