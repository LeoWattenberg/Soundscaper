/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import {
	COPY, createAudioEditorController, createMemoryEngine, createProjectStore,
} from './helpers/audio-editor-controller-harness.js';

for (const selectionKind of ['headers', 'range'] as const) {
	test(`Edit Duplicate preserves outgoing routes for ${selectionKind} in one history entry`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, {
			headless: true, locale: 'en', copy: COPY, projectRuntime,
			sessionController: projectRuntime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round5-duplicate-${selectionKind}` }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', {
			amplitude: 0.4, channelCount: 2, durationSeconds: 0.1, frequency: 440,
		});
		const selected = controller.getSnapshot();
		assert.ok(selected.selectedTrackId);
		assert.ok(selected.selectedClipId);
		const trackId = selected.selectedTrackId;
		const groupId = controller.actions.mixer.addBus('group');
		const sendId = controller.actions.mixer.addBus('send');
		controller.actions.mixer.setRoute(trackId, { groupId, sends: { [String(sendId)]: 0.5 } });
		if (selectionKind === 'headers') controller.actions.timeline.selectClip(selected.selectedClipId);
		else controller.actions.timeline.setSelection(480, 3840, { trackIds: [trackId] });
		const original = controller.getSnapshot().project!;
		const before = original.mixer as unknown as MixerGraphV21;
		controller.actions.edit.duplicate();
		const duplicated = controller.getSnapshot();
		assert.ok(duplicated.selectedTrackId);
		assert.notEqual(duplicated.selectedTrackId, trackId);
		const after = duplicated.project!.mixer as unknown as MixerGraphV21;
		const describeRoutes = (graph: MixerGraphV21, id: string) => graph.edges
			.filter(edge => edge.source.kind === 'track' && edge.source.id === id)
			.map(({ kind, destination, position, level, enabled, channelMap }) => (
				{ kind, destination, position, level, enabled, channelMap }
			));
		assert.deepEqual(describeRoutes(after, duplicated.selectedTrackId), describeRoutes(before, trackId));
		assert.deepEqual(describeRoutes(after, trackId), describeRoutes(before, trackId));
		assert.equal(new Set(after.edges.map(edge => edge.id)).size, after.edges.length);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, original.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, original.clips);
		assert.deepEqual(controller.getSnapshot().project!.mixer, before);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, after);
	});
}
