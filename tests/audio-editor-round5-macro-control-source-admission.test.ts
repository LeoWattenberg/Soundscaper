/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { createEffectRenderSourcePreparation } from '../src/common/editor/controller/effects/internal/effect-render-source-preparation.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

test('a macro control render admits its lazily stored media before scheduling', async () => {
	const sources = ['music', 'voice'].map(id => createAudioSource({ id, frameCount: 96_000,
		channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536 }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 96_000, durationFrames: 96_000 }));
	const project = createSoundscaperProject({ id: 'control-admission', sources, clips,
		tracks: sources.map(source => createAudioTrack({ id: `${source.id}-track`,
			clipIds: [`${source.id}-clip`], mute: source.id === 'voice' })) });
	const input = new Float32Array(96_000).fill(0.35);
	const buffer: AudioBuffer = { sampleRate: 48_000, length: input.length, numberOfChannels: 1, duration: 2,
		getChannelData: () => input,
		copyFromChannel: (destination, _channel, start = 0) => destination.set(input.subarray(start, start + destination.length)),
		copyToChannel: (source, _channel, start = 0) => input.set(source, start) };
	let prepared = 0;
	let scheduledProject: EngineProject | null = null;
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	const harness = createHarness({ project: project as unknown as EffectAudioProject,
		prepareRenderSources: createEffectRenderSourcePreparation({ sourceBuffers: new Map(), loadProjectSources: async (_snapshot, options) => {
			assert.deepEqual(options.requiredAudioSourceIds, ['voice']);
			assert.equal(options.onlyRequiredAudioSources, true);
			prepared++;
			return new Map([['voice', buffer]]);
		} }),
		validateRenderSnapshot: snapshot => {
			assert.deepEqual(snapshot.tracks.map(track => track.id), ['voice-track']);
			assert.equal(snapshot.tracks[0]?.mute, false);
			engine.loadProject(snapshot as EngineProject, new Map());
			scheduledProject = projectForRuntimeConsumers(snapshot) as EngineProject;
		},
		validateRenderSources: sources => {
			assert.ok(sources instanceof Map);
			assert.ok(scheduledProject);
			const plans = buildClipSchedulePlans({ project: scheduledProject, sources,
				trackInputs: new Map([['voice-track', {} as AudioNode]]),
				fromFrame: 0, toFrame: 96_000, sampleRate: 48_000 });
			assert.equal(plans.length, 1, 'the voice is scheduled instead of silent missing-source PCM');
			assert.equal(plans[0]?.originalBuffer, buffer);
		},
	});
	try {
		await harness.service.renderDryTrackRange('voice-track', 0, 96_000);
		assert.equal(prepared, 1);
	} finally { await engine.dispose(); }
});
