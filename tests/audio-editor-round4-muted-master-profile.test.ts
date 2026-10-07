/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';

test('master rack profiling bypasses the listening mute while preserving the authored mix', async () => {
	const prefix = createEffect('audacity-reverb', { id: 'before' });
	const noise = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
	const suffix = createEffect('audacity-reverb', { id: 'after' });
	const project = createSoundscaperProject({ id: 'muted-profile',
		tracks: [createAudioTrack({ id: 'track-a', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['track-a'] }], primarySequenceId: 'main',
		master: { mute: true, gain: 0.25, effects: [prefix, noise, suffix] },
	});
	const authored = structuredClone(project);
	const harness = createHarness({ project });
	harness.setSelection({ startFrame: 100, endFrame: 4_100, trackIds: ['track-a'], clipIds: [] });
	await harness.service.captureRackNoiseProfile(noise, 'master');
	assert.equal(harness.snapshots[0]?.master.mute, false);
	assert.equal(harness.snapshots[0]?.master.gain, 1);
	assert.deepEqual(harness.snapshots[0]?.master.effects.map(effect => effect.id), ['before']);
	assert.equal(harness.prefixDisposals, 1);
	assert.equal(harness.commands.length, 1);
	assert.deepEqual(project, authored);
});
