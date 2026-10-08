/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

for (const [name, channelMap, centered, enabled] of [
	['swapped left/right', [1, 0], false, true],
	['right-only', [-1, 1], false, true],
	['left into right', [-1, 0], false, true],
	['right into left', [1, -1], false, true],
	['centered swap', [1, 0], true, true],
	['temporarily disabled swap', [1, 0], false, false],
] as const) {
	test(`stereo splitting refuses ${name} before changing audio, storage, routing or history`, async context => {
		const { controller, trackId } = await fixture(context);
		const sendId = controller.actions.mixer.addBus('send');
		assert.equal(typeof sendId, 'string');
		if (typeof sendId !== 'string') throw new Error('Missing send.');
		controller.actions.mixer.setRoute(trackId, { sends: { [sendId]: 0.5 } });
		const graph = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
		const mapped: MixerGraphV21 = { ...graph, edges: graph.edges.map(edge => (
			edge.source.kind === 'track' && edge.source.id === trackId && edge.kind === 'send'
				? { ...edge, channelMap, enabled } : edge
		)) };
		// This is the exact graph command published by the normal Routing graph form.
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph, mixer: mapped });
		const before = controller.getSnapshot();
		const operation = () => centered ? controller.actions.track.splitStereoCenter(trackId)
			: controller.actions.track.splitStereoLR(trackId);
		await assert.rejects(operation, /Reset or remove the custom channel map in Routing graph/u);
		const refused = controller.getSnapshot();
		assert.deepEqual(refused.project, before.project);
		assert.deepEqual(refused.history, before.history);
		// Use the same existing graph action as the inspector's Reset channel map button.
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: mapped, mixer: graph });
		const recovery = controller.getSnapshot();
		const split = await operation();
		assert.ok(split);
		const completed = controller.getSnapshot();
		assert.equal(completed.history.undoEntries.length, recovery.history.undoEntries.length + 1);
		assert.equal(completed.project!.clips.length, 2);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, recovery.project!.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, recovery.project!.clips);
		assert.deepEqual(controller.getSnapshot().project!.mixer, recovery.project!.mixer);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, completed.project!.tracks);
		assert.deepEqual(controller.getSnapshot().project!.mixer, completed.project!.mixer);
	});
}

for (const channelMap of [[0, 1], [-1, -1]] as const) {
	test(`stereo splitting retains the supported ${channelMap.join(',')} route`, async context => {
		const { controller, trackId } = await fixture(context);
		const graph = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: graph, mixer: {
			...graph, edges: graph.edges.map(edge => edge.source.kind === 'track'
				&& edge.source.id === trackId ? { ...edge, channelMap } : edge),
		} });
		const split = await controller.actions.track.splitStereoLR(trackId);
		assert.ok(split);
		const routes = (controller.getSnapshot().project!.mixer as unknown as MixerGraphV21).edges
			.filter(edge => edge.source.kind === 'track' && [split.leftTrackId, split.rightTrackId].includes(edge.source.id));
		assert.equal(routes.length, 2);
		assert.deepEqual(routes.map(edge => edge.channelMap), channelMap[0] === -1
			? [[-1, -1], [-1, -1]] : [[0, 0], [0, 0]]);
	});
}

async function fixture(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 2,
		durationSeconds: 0.1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId;
	assert.equal(typeof trackId, 'string');
	if (typeof trackId !== 'string') throw new Error('Missing stereo recording.');
	return { controller, trackId };
}
