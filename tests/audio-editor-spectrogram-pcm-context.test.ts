/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { spectrogramPcmContextClip } from '../src/common/editor/ui/timeline/spectrogram-pcm-context.ts';
import type { TimelineWaveformClip } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

const CLIP: TimelineWaveformClip = {
	id: 'clip', sourceId: 'source', timelineStartFrame: 0,
	sourceStartFrame: 0, durationFrames: 48_000,
	waveformStartFrame: 20_000, waveformEndFrame: 20_018,
};

test('spectrogram PCM context surrounds a short painted range without moving it', () => {
	const context = spectrogramPcmContextClip(CLIP, 2048);
	assert.equal(context.waveformStartFrame, 20_000 - 1024);
	assert.equal(context.waveformEndFrame, 20_018 + 1024);
	assert.equal(CLIP.waveformStartFrame, 20_000);
	assert.equal(CLIP.waveformEndFrame, 20_018);
});

test('spectrogram PCM context clamps at both clip boundaries', () => {
	assert.deepEqual(
		[
			spectrogramPcmContextClip({ ...CLIP, waveformStartFrame: 0, waveformEndFrame: 18 }, 2048),
			spectrogramPcmContextClip({ ...CLIP, waveformStartFrame: 47_982, waveformEndFrame: 48_000 }, 2048),
		].map(({ waveformStartFrame, waveformEndFrame }) => [waveformStartFrame, waveformEndFrame]),
		[[0, 1042], [46_958, 48_000]],
	);
});
