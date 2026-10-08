/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine,
	createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mode of ['active', 'disabled effect', 'inactive rack', 'serial effects', 'later partner'] as const) {
	test(`Make stereo ${mode} captures each rendered rack's audible end and one Undo`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r5-stereo-tail-${mode}` }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', {
			amplitude: 0.35, channelCount: 1, durationSeconds: 0.8, frequency: 440,
		});
		const left = controller.getSnapshot().selectedTrackId;
		assert.equal(typeof left, 'string');
		if (typeof left !== 'string') throw new Error('Missing left recording.');
		controller.actions.effects.add({ scope: 'track', trackId: left, type: 'delay',
			options: { enabled: mode !== 'disabled effect', params: { time: mode === 'serial effects' ? 0.2 : 0.5, feedback: 0, mix: 1 } } });
		if (mode === 'serial effects') controller.actions.effects.add({ scope: 'track', trackId: left,
			type: 'delay', options: { params: { time: 0.3, feedback: 0, mix: 1 } } });
		if (mode === 'inactive rack') controller.actions.track.update(left, { effectsActive: false });
		const right = controller.actions.track.add({ name: 'Right' });
		assert.equal(typeof right, 'string');
		if (typeof right !== 'string') throw new Error('Missing right recording.');
		await controller.actions.generators.generate('tone', {
			amplitude: 0.1, channelCount: 1, durationSeconds: mode === 'later partner' ? 1.2 : 0.8, frequency: 660,
		});
		const before = controller.getSnapshot().project!;
		const count = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.track.makeStereo(left, right);
		const after = controller.getSnapshot().project!;
		const projection = runtime.projectForCommandConsumers(after) as ControllerProject;
		const clip = projection.clips[0];
		assert.ok(clip);
		const expectedFrames = mode === 'disabled effect' || mode === 'inactive rack' ? 38_400 : 62_400;
		assert.equal(clip.durationFrames, expectedFrames);
		assert.equal(clip.sourceDurationFrames, expectedFrames);
		assert.equal(projection.sources.find(source => source.id === clip.sourceId)?.frameCount, expectedFrames);
		assert.deepEqual(projection.tracks.find(track => track.id === left)?.effects, []);
		assert.equal(controller.getSnapshot().history.undoEntries.length, count + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, before.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, before.clips);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, after.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, after.clips);
	});
}
