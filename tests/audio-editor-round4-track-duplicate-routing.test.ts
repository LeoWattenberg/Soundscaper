/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import {
	COPY, createAudioEditorController, createMemoryEngine, createProjectStore,
} from './helpers/audio-editor-controller-harness.js';

test('public Duplicate track copies authored output and sends in one history entry', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime,
		sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round4-track-routing' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', {
		amplitude: 0.4, channelCount: 2, durationSeconds: 0.1, frequency: 440,
	});
	const trackId = controller.getSnapshot().selectedTrackId!;
	const groupId = controller.actions.mixer.addBus('group');
	const sendId = controller.actions.mixer.addBus('send');
	controller.actions.mixer.setRoute(trackId, { groupId, sends: { [String(sendId)]: 0.5 } });
	const before = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	controller.actions.track.duplicate(trackId);
	const targetId = controller.getSnapshot().selectedTrackId;
	assert.ok(targetId);
	assert.notEqual(targetId, trackId);
	const after = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
	const describeRoutes = (graph: MixerGraphV21, id: string) => graph.edges
		.filter(edge => edge.source.kind === 'track' && edge.source.id === id)
		.map(({ kind, destination, position, level, enabled, channelMap }) => (
			{ kind, destination, position, level, enabled, channelMap }
		));
	assert.deepEqual(describeRoutes(after, targetId), describeRoutes(before, trackId));
	assert.deepEqual(describeRoutes(after, trackId), describeRoutes(before, trackId));
	assert.equal(new Set(after.edges.map(edge => edge.id)).size, after.edges.length);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, before);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, after);
});
