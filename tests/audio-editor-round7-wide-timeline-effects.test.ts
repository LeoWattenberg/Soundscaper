/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';
import { serializeAudacityNoiseProfile } from '../src/common/editor/controller/source/source-audio.ts';
import { audacitySelectionChannelCount, matchAudacitySelectionChannels } from '../src/common/editor/audacity-selection.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const width of [1, 2, 4, 6, 32]) for (const kind of ['clip', 'range', 'macro', 'profile'] as const) {
	test(`timeline ${kind} processing retains every native channel of a ${String(width)}-channel recording`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const frameCount = kind === 'profile' ? 4096 : 512;
		const input = Array.from({ length: width }, (_, channel) => Float32Array.from(
			{ length: frameCount }, (_, frame) => .1 + channel / 100 + frame / 10_000));
		const source = createAudioSource({ id: 'recording', name: 'Recording', channelCount: width,
			frameCount, sampleRate: 48_000, originalSampleRate: 48_000 });
		const clip = createAudioClip({ id: 'phrase', sourceId: source.id, sourceStartFrame: 0,
			sourceDurationFrames: frameCount, durationFrames: frameCount, timelineStartFrame: 100 });
		const project = createSoundscaperProject({ id: `wide-timeline-${String(width)}-${kind}`,
			sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'audio', name: 'Audio',
				clipIds: [clip.id], gain: .8 })] });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
		const writer = await store.beginSourceWrite(source.id, {
			name: source.name, mimeType: 'audio/wav', sampleRate: 48_000, channelCount: width,
		});
		await writer.write(input);
		await writer.commit({ sampleRate: 48_000, channelCount: width });
		await store.saveProject(project);
		await store.saveSetting('last-project-id', project.id);
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const captures: EngineProject[] = [];
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime, sessionController: projectRuntime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: () => createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
				softwareRenderer: async ({ project: value, captureStartFrame, endFrame, sampleRate }) => {
					const capture = value as EngineProject;
					captures.push(capture);
					assert.equal(capture.tracks?.length, 1);
					assert.equal(capture.tracks[0]?.gain, 1, 'the dry capture excludes listening gain');
					const channels = Array.from({ length: Number(capture.masterChannels) },
						(_, channel) => (input[channel] ?? input[0]!).slice(Number(captureStartFrame) - 100, Number(endFrame) - 100));
					return { sampleRate: Number(sampleRate), channels: capture.tracks[0]?.effects?.some(effect => effect.type === 'audacity-invert')
						? await applyAudioSelectionEffectAsync('audacity-invert', channels, Number(sampleRate)) : channels };
				},
			}),
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		controller.actions.timeline.selectClip(clip.id);
		if (kind === 'range') controller.actions.timeline.setSelection(100, 100 + frameCount, { trackIds: ['audio'] });
		if (kind === 'profile') {
			const effectId = controller.actions.effects.add({ scope: 'track', trackId: 'audio', type: 'audacity-noise-reduction' });
			assert.ok(typeof effectId === 'string');
			const beforeProfile = controller.getSnapshot().project;
			assert.ok(validateSoundscaperProject(beforeProfile));
			await controller.actions.effects.captureRackNoiseProfile('track', 'audio', effectId);
			const profiled = controller.getSnapshot().project;
			assert.ok(validateSoundscaperProject(profiled));
			const track = profiled.tracks.find(candidate => candidate.id === 'audio');
			assert.ok(track?.type === 'audio');
			const effect = track.effects.find(candidate => candidate.id === effectId);
			assert.ok(effect?.enabled);
			await initializePffft();
			assert.deepEqual(effect.context?.noiseProfile, serializeAudacityNoiseProfile(captureAudacityNoiseProfile(input, 48_000)));
			assert.equal(captures.length, 1);
			assert.equal(captures[0]!.masterChannels, Math.max(2, width));
			assert.equal(profiled.masterChannels, 2);
			assert.deepEqual(profiled.clips, beforeProfile.clips);
			assert.deepEqual((await store.readSourceChunk(source.id, 0)).channels, input);
			controller.actions.edit.undo();
			assert.deepEqual(controller.getSnapshot().project!.tracks, beforeProfile.tracks);
			controller.actions.edit.redo();
			assert.deepEqual(controller.getSnapshot().project!.tracks, profiled.tracks);
			return;
		}
		const before = structuredClone(controller.getSnapshot().project);
		assert.ok(validateSoundscaperProject(before));
		if (kind === 'macro') await controller.actions.macros.run({ name: 'Invert', effects: [{ type: 'audacity-invert' }] });
		else await controller.actions.effects.applySelection({ type: 'audacity-invert' });
		const after = controller.getSnapshot().project;
		assert.ok(validateSoundscaperProject(after));
		const processedTrack = after.tracks.find(track => track.id === 'audio');
		assert.ok(processedTrack?.type === 'audio');
		const processedIds = processedTrack.clipIds;
		const processedClip = after.clips.find(item => processedIds.includes(item.id));
		assert.ok(processedClip?.kind === 'audio' && typeof processedClip.sourceId === 'string');
		assert.notEqual(processedClip.sourceId, source.id);
		const saved = await store.readSourceChunk(processedClip.sourceId, 0);
		assert.equal(saved.channels.length, width);
		for (let channel = 0; channel < width; channel++) {
			assert.deepEqual(saved.channels[channel], input[channel]!.map(sample => -sample));
		}
		assert.equal(captures.length, 1);
		assert.equal(captures[0]!.masterChannels, Math.max(2, width));
		assert.equal(after.masterChannels, 2, 'processing preserves the authored programme layout');
		assert.deepEqual(after.tracks.map(track => ({ ...track, clipIds: [] })),
			before.tracks.map(track => ({ ...track, clipIds: [] })));
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.clips, before.clips);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.clips, after.clips);
	});
}

test('timeline layout retains the widest overlapping source and refuses an incomplete native render', () => {
	const project = { tracks: [{ id: 'audio', clipIds: ['stereo', 'surround'] }],
		clips: [{ id: 'stereo', sourceId: 'stereo', timelineStartFrame: 0, durationFrames: 100 },
			{ id: 'surround', sourceId: 'surround', timelineStartFrame: 50, durationFrames: 100 }],
		sources: [{ id: 'stereo', channelCount: 2 }, { id: 'surround', channelCount: 6 }] };
	assert.equal(audacitySelectionChannelCount(project, 'audio', 0, 100), 6);
	assert.throws(() => matchAudacitySelectionChannels([new Float32Array(100), new Float32Array(100)], 6), /channel/u);
});
