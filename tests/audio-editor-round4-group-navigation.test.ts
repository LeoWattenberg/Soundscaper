/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	COPY, createAudioEditorController, createMemoryEngine, createProjectStore,
} from './helpers/audio-editor-controller-harness.js';

for (const source of ['generated', 'imported']) test(`public adjacent clip selection expands an authored ${source} group and its exact range`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime,
		sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round4-group-navigation-${source}` }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	if (source === 'generated') await controller.actions.generators.generate('tone', {
		amplitude: 0.4, channelCount: 1, durationSeconds: 0.8, frequency: 440,
	});
	else await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([
		new Float32Array(38_400).fill(0.4),
	], { sampleRate: 48_000, bitDepth: 16 }))], 'Recording.wav', { type: 'audio/wav' })]);
	const trackId = controller.getSnapshot().selectedTrackId!;
	controller.actions.edit.splitAt(9_600, [trackId]);
	controller.actions.edit.splitAt(28_800, [trackId]);
	const project = projectRuntime.projectForCommandConsumers(controller.getSnapshot().project) as ControllerProject;
	const clips = project.clips.filter(clip => clip.kind === 'audio').sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	assert.equal(clips.length, 3);
	const [left, middle, right] = clips;
	assert.ok(left && middle && right);
	controller.actions.timeline.selectClip(middle.id);
	controller.actions.timeline.selectClip(right.id, { additive: true });
	controller.actions.edit.group();
	controller.actions.timeline.selectClip(null);
	controller.actions.timeline.setSelection(0, 0, { trackIds: [trackId] });
	controller.actions.timeline.selectNextClip();
	assert.deepEqual(selection().clipIds, [left.id]);
	controller.actions.timeline.selectNextClip();
	const selected = selection();
	assert.deepEqual(new Set(selected.clipIds), new Set([middle.id, right.id]));
	assert.deepEqual([selected.startFrame, selected.endFrame, selected.trackIds], [9_600, 38_400, [trackId]]);
	assert.equal(controller.getSnapshot().selectedClipId, middle.id);
	controller.actions.timeline.selectPreviousClip();
	assert.deepEqual(selection().clipIds, [left.id]);
	controller.actions.timeline.setSelection(38_400, 38_400, { trackIds: [trackId] });
	controller.actions.timeline.selectPreviousClip();
	assert.deepEqual(new Set(selection().clipIds), new Set([middle.id, right.id]));
	assert.equal(controller.getSnapshot().selectedClipId, right.id);
	function selection() {
		const current = projectRuntime.projectForCommandConsumers(controller.getSnapshot().project) as ControllerProject;
		assert.ok(current.selection);
		return current.selection;
	}
});
