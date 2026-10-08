/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';

function fixture() {
	const prefix = createEffect('lowpass', { id: 'before', params: { frequency: 750, q: 0.707 } });
	const noise = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
	const suffix = createEffect('lowpass', { id: 'after' });
	const lane = (id: string, address: ParameterAddress, value: number) => normalizeAutomationLaneV21({
		id, address, timebase: 'absolute-samples',
		points: [{ id: `${id}-first`, position: 0, value }, { id: `${id}-last`, position: 38_400, value }],
		segments: [{ kind: 'linear' }],
	});
	const effect = (effectId: string, trackId = 'track-a'): ParameterAddress =>
		({ kind: 'effect', strip: { kind: 'track', id: trackId }, effectId, parameterId: 'q' });
	const source = createAudioSource({ id: 'source-a', frameCount: 38_400, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip-a', sourceId: source.id, durationFrames: 38_400, sourceDurationFrames: 38_400 });
	const project = createSoundscaperProject({ id: 'rack-prefix-automation', sources: [source], clips: [clip],
		selection: { startFrame: 0, endFrame: 38_400, trackIds: ['track-a'], clipIds: ['clip-a'] },
		tracks: [createAudioTrack({ id: 'track-a', clipIds: [clip.id], effects: [prefix, noise, suffix],
			gain: 0.25, pan: 0.5, mute: true, solo: true }),
		createAudioTrack({ id: 'other', effects: [createEffect('lowpass', { id: 'other-filter' })] })],
		automationLanes: [lane('prefix-q', effect('before'), 1.707), lane('suffix-q', effect('after'), 3),
			lane('other-q', effect('other-filter', 'other'), 2),
			lane('listening-gain', { kind: 'strip', strip: { kind: 'track', id: 'track-a' }, parameterId: 'gain' }, 0.1)],
	});
	return { project, noise };
}

test('track rack profiling retains only earlier owned effect automation with its exact values', async () => {
	const { project, noise } = fixture();
	const authored = structuredClone(project);
	const harness = createHarness({ project });
	await harness.service.captureRackNoiseProfile(noise, 'track', 'track-a');
	const capture = harness.snapshots[0]; assert.ok(capture);
	assert.deepEqual(capture.automationLanes, [project.automationLanes[0]]);
	assert.deepEqual(capture.tracks[0]?.effects?.map(effect => effect.id), ['before']);
	assert.equal(capture.tracks[0]?.gain, 1);
	assert.equal(capture.tracks[0]?.pan, 0);
	assert.equal(capture.tracks[0]?.mute, false);
	assert.equal(capture.tracks[0]?.solo, false);
	assert.equal(harness.commands.length, 1);
	assert.equal(harness.prefixDisposals, 1);
	assert.deepEqual(project, authored);
});

test('destructive dry selection rendering still excludes all rack and listening automation', async () => {
	const { project } = fixture();
	const harness = createHarness({ project });
	await harness.service.renderDryTrackRange('track-a', 0, 38_400, 1);
	assert.deepEqual(harness.snapshots[0]?.automationLanes, []);
	assert.deepEqual(harness.snapshots[0]?.tracks[0]?.effects, []);
});
