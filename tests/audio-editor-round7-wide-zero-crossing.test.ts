/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const width of [1, 2, 6, 32]) test(`zero-crossing preparation retains a normally generated ${String(width)}-channel lane`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const captures: SoundscaperProject[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round7-crossing-width-${String(width)}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
			softwareRenderer: ({ project, captureStartFrame, endFrame, sampleRate }) => {
				const capture = project as SoundscaperProject;
				captures.push(capture);
				return { channels: Array.from({ length: Number(capture.masterChannels) },
					() => new Float32Array(Number(endFrame) - Number(captureStartFrame))), sampleRate };
			},
		}),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .35, channelCount: width, durationSeconds: 1, frequency: 197,
	});
	assert.ok(clipId);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.setSelection(10_007, 30_007);
	const before = structuredClone(controller.getSnapshot().project);
	await controller.actions.timeline.zeroCross();
	assert.equal(captures.length, 1);
	assert.equal(captures[0]!.masterChannels, Math.max(2, width), 'the temporary output must admit every occupied source channel');
	assert.deepEqual(controller.getSnapshot().project!.sources, before!.sources);
	assert.equal(controller.getSnapshot().project!.masterChannels, 2, 'analysis does not alter the authored programme output');
});
