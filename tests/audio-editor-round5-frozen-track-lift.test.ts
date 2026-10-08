/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperAudioFreezeActions, type SoundscaperAudioFreezeRenderEngine } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine,
	createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const extent of ['complete', 'partial'] as const) test(`${extent} frozen range lifts with exact retirement and one history entry`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	type FreezeEnvironment = Parameters<typeof createSoundscaperAudioFreezeActions>[0];
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r5-freeze-lift-${extent}` });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const playback = createSoundscaperAudioTrackFreezePlaybackService(
		createSoundscaperPlaybackProjectService(), store as unknown as FreezeEnvironment['store']);
	const freeze = createSoundscaperAudioFreezeActions({ store: store as unknown as FreezeEnvironment['store'], playback },
		controller as unknown as Parameters<typeof createSoundscaperAudioFreezeActions>[1], {
			createRenderEngine: () => {
				const engine = createMemoryRenderEngine();
				return { ...engine, renderTrack: (_trackId: string, range: EngineRenderMixOptions = {}) => engine.renderMix(range) } as unknown as SoundscaperAudioFreezeRenderEngine;
			},
		});
	context.after(async () => { await freeze.dispose(); await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', {
		amplitude: 0.2, channelCount: 2, durationSeconds: 0.02, frequency: 440,
	});
	const trackId = controller.getSnapshot().selectedTrackId;
	assert.ok(trackId);
	controller.actions.effects.add({ scope: 'track', trackId, type: 'delay' });
	const groupId = controller.actions.mixer.addBus('group');
	assert.equal(typeof groupId, 'string');
	if (typeof groupId !== 'string') throw new Error('Missing programme bus.');
	controller.actions.mixer.setRoute(trackId, { groupId });
	await freeze.actions.freeze(trackId);
	assert.equal(freeze.actions.getStatus(trackId), 'fresh');
	controller.actions.timeline.setSelection(0, extent === 'complete' ? 960 : 480, { trackIds: [trackId] });
	const before = controller.project! as unknown as SoundscaperProject;
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.splitIntoNewTrack();
	const after = controller.project! as unknown as SoundscaperProject;
	assert.equal(after.tracks!.length, before.tracks!.length + 1, JSON.stringify(controller.getSnapshot().status));
	const original = after.tracks!.find(track => track.id === trackId);
	assert.ok(original);
	assert.equal(Object.hasOwn(original, 'audioFreeze'), extent === 'partial');
	const old = before.tracks!.find(track => track.id === trackId);
	assert.ok(old);
	if (extent === 'partial') assert.deepEqual(original.audioFreeze, old.audioFreeze);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project!.tracks, before.tracks);
	assert.deepEqual(controller.project!.clips, before.clips);
	assert.deepEqual(controller.project!.sources, before.sources);
	assert.deepEqual(controller.project!.mixer, before.mixer);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project!.tracks, after.tracks);
	assert.deepEqual(controller.project!.clips, after.clips);
	assert.deepEqual(controller.project!.mixer, after.mixer);
});
