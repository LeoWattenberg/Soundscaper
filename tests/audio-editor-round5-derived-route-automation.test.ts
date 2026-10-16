/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const operation of ['track Duplicate', 'Edit Duplicate', 'Split into new track', 'stereo Split'] as const) {
	for (const kind of ['assignment', 'send'] as const) test(`${operation} copies ${kind} automation to its actual route identity`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime, sessionController: projectRuntime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `route-automation-${kind}-${operation}` }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', { amplitude: 0.4,
			channelCount: 2, durationSeconds: 0.1, frequency: 440 });
		const sourceTrackId = controller.getSnapshot().selectedTrackId;
		const clipId = controller.getSnapshot().selectedClipId;
		assert.ok(sourceTrackId && clipId);
		if (typeof sourceTrackId !== 'string' || typeof clipId !== 'string') throw new Error('Missing generated clip.');
		if (kind === 'send') {
			const sendId = controller.actions.mixer.addBus('send');
			controller.actions.mixer.setSend(sourceTrackId, String(sendId), 1);
		}
		const graph = controller.getSnapshot().project!.mixer as unknown as MixerGraphV21;
		const edge = graph.edges.find(candidate => candidate.kind === kind
			&& candidate.source.kind === 'track' && candidate.source.id === sourceTrackId);
		assert.ok(edge);
		const originalLane = normalizeAutomationLaneV21({ id: 'output-ride',
			address: { kind: 'edge', edgeId: edge.id, parameterId: 'level' }, timebase: 'absolute-samples',
			points: [{ id: 'ride-start', position: 0, value: 0.75 }, { id: 'ride-end', position: 4800, value: 0.5 }],
			segments: [{ kind: 'linear' }] });
		// Inline lane editing uses this command through the same public controller action.
		controller.actions.edit.commit({ type: 'automation-lane/set', laneId: originalLane.id,
			expected: null, lane: { ...originalLane } });
		controller.actions.timeline.selectClip(clipId);
		const original = controller.getSnapshot().project!;
		const history = controller.getSnapshot().history.undoEntries.length;
		if (operation === 'track Duplicate') controller.actions.track.duplicate(sourceTrackId);
		else if (operation === 'Edit Duplicate') controller.actions.edit.duplicate();
		else if (operation === 'stereo Split') await controller.actions.track.splitStereoLR(sourceTrackId);
		else {
			controller.actions.timeline.setSelection(0, 4800, { trackIds: [sourceTrackId] });
			controller.actions.edit.splitIntoNewTrack();
		}
		const after = controller.getSnapshot().project!;
		const afterGraph = after.mixer as unknown as MixerGraphV21;
		const lanes = (after.automationLanes as readonly unknown[]).map(value => normalizeAutomationLaneV21(value));
		const derivedRoutes = afterGraph.edges.filter(candidate => candidate.kind === kind
			&& candidate.source.kind === 'track' && candidate.source.id !== sourceTrackId);
		assert.equal(derivedRoutes.length, 1);
		const copied = lanes.find(lane => lane.address.kind === 'edge' && lane.address.edgeId === derivedRoutes[0]!.id);
		assert.ok(copied);
		assert.notEqual(copied.id, originalLane.id);
		assert.ok(copied.points.every((point, index) => point.id !== originalLane.points[index]?.id));
		assert.deepEqual(copied.points.map(({ position, value }) => ({ position, value })),
			originalLane.points.map(({ position, value }) => ({ position, value })));
		assert.deepEqual(copied.segments, originalLane.segments);
		assert.deepEqual(lanes.find(lane => lane.id === originalLane.id), originalLane);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, original.mixer);
		assert.deepEqual(controller.getSnapshot().project!.automationLanes, original.automationLanes);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, after.mixer);
		assert.deepEqual(controller.getSnapshot().project!.automationLanes, after.automationLanes);
	});
}
