/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { EffectAudioProject } from '../src/common/editor/controller/effect-audio-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

void test('effect rendering accepts admitted audio and visual documents without resolved coordinates', () => {
	const current: EffectAudioProject = createCurrentAudioEditorProject();
	const frame: EffectAudioProject = createFramescaperProject();
	assert.equal(current.schemaVersion, 17);
	assert.equal(frame.schemaFamily, 'framescaper');
	assert.equal(frame.schemaVersion, 1);
});

void test('rack profiling uses a musical clip range when no time selection is active', async () => {
	const effect = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
	const source = createAudioSource({ id: 'source', frameCount: 96_000, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip-a', sourceId: source.id, sourceStartFrame: 0,
		sourceDurationFrames: 96_000, anchor: 'musical', musicalStartBeat: 2,
		musicalExtent: 'beat', musicalDurationBeats: 2,
	});
	const project = createCurrentAudioEditorProject({ sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track-a', clipIds: [clip.id], effects: [effect] })],
	});
	assert.equal(Object.hasOwn(project.clips[0], 'timelineStartFrame'), false);
	const harness = createHarness({ project });
	harness.setSelection(null);
	await harness.service.captureRackNoiseProfile(effect, 'track', 'track-a');
	assert.equal(harness.commands.length, 1);
});
