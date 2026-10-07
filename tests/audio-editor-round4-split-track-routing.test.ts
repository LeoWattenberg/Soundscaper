/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mode of ['clip', 'range'] as const) test(`public Split into new track retains authored outgoing routing for ${mode}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime,
		sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round4-split-routing-${mode}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 2, durationSeconds: 0.8, frequency: 440 });
	const sourceTrackId = controller.getSnapshot().selectedTrackId!;
	const clipId = controller.getSnapshot().selectedClipId!;
	const groupId = controller.actions.mixer.addBus('group');
	const sendId = controller.actions.mixer.addBus('send');
	controller.actions.mixer.setRoute(sourceTrackId, { groupId, sends: { [String(sendId)]: 0.5 } });
	controller.actions.timeline.selectClip(clipId);
	if (mode === 'range') controller.actions.timeline.setSelection(10_000, 30_000, { trackIds: [sourceTrackId] });
	else controller.actions.transport.seek(20_000);
	const before = controller.getSnapshot();
	const originalGraph = before.project!.mixer as unknown as MixerGraphV21;
	controller.actions.edit.splitIntoNewTrack();
	const after = controller.getSnapshot();
	const targetId = after.selectedTrackId!;
	assert.notEqual(targetId, sourceTrackId);
	const graph = after.project!.mixer as unknown as MixerGraphV21;
	assert.deepEqual(routes(graph, targetId), routes(originalGraph, sourceTrackId));
	assert.deepEqual(routes(graph, sourceTrackId), routes(originalGraph, sourceTrackId));
	assert.equal(new Set(graph.edges.map(edge => edge.id)).size, graph.edges.length);
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, originalGraph);
	assert.deepEqual(controller.getSnapshot().project!.clips, before.project!.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.mixer, graph);
	assert.deepEqual(controller.getSnapshot().project!.clips, after.project!.clips);
});

function routes(graph: MixerGraphV21, trackId: string) {
	return graph.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === trackId)
		.map(({ kind, destination, position, level, enabled, channelMap }) => ({ kind, destination, position, level, enabled, channelMap }));
}
