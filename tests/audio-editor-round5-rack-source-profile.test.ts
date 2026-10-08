/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';

for (const nativeRate of [24_000, 48_000]) {
	test(`a ${nativeRate} Hz Source selection keeps its authored track rack profile reachable`, async () => {
		const effect = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
		const project = createSoundscaperProject({ id: 'project', sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', sampleRate: nativeRate, frameCount: nativeRate, channelCount: 1 })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 240_000,
				sourceStartFrame: 0, sourceDurationFrames: nativeRate, durationFrames: 48_000 })],
			tracks: [createAudioTrack({ id: 'track-a', clipIds: ['clip'], effects: [effect] })],
			selection: { startFrame: 240_000, endFrame: 288_000, trackIds: ['track-a'], clipIds: ['clip'] },
		});
		const source = createSourceEditorEffects({ getProject: () => project as unknown as EffectSelectionProject,
			loadSourceBuffer: () => { throw new Error('Rack profiling renders its timeline snapshot.'); }, publishDocumentSnapshot() {} });
		source.setSourceSelection({ clipId: 'clip', startFrame: 0, endFrame: nativeRate });
		const target = source.target(); assert.ok(target);
		const harness = createHarness({ project: project as unknown as EffectAudioProject, target });
		await harness.service.captureRackNoiseProfile(effect, 'track', 'track-a');
		assert.equal(harness.commands.length, 1);
		assert.deepEqual(harness.commands[0], { type: 'effect/update', scope: 'track', trackId: 'track-a',
			effectId: 'noise', changes: { enabled: true, context: { noiseProfile: { serialized: { bins: [1, 2] } } } } });
		assert.equal(harness.snapshots[0]?.tracks[0]?.id, 'track-a');
		assert.equal(source.target()?.durationFrames, nativeRate);
		assert.equal(harness.prefixDisposals, 1);
	});
}
