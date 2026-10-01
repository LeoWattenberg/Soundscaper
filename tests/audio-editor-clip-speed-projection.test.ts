/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

function projectSpeed(speedRatio: number, durationFrames: number, sourceRate = 48_000) {
	const source = { id: 'source', name: 'Source', sampleRate: sourceRate, frameCount: 100, channelCount: 1 };
	return createTimelineClipViewModel({
		controller: { getClipVisualData: () => null, getProjectBinClipVisualData: () => null },
		sourceLookup: new Map([[source.id, source]]),
		clip: {
			id: 'clip', sourceId: source.id, title: 'Clip', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames,
			waveformStartFrame: 0, waveformEndFrame: durationFrames, speedRatio,
		},
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 120, sampleRate: 48_000 },
		selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: { color: 'blue' },
	});
}

test('the clip speed indicator receives the exact speed even when its duration rounds to unchanged frames', () => {
	const projection = projectSpeed(0.9999999, 100);
	assert.equal(projection.stretchFactor, 1);
	assert.equal(projection.speedRatio, 0.9999999);
});

test('sample-rate conversion frame rounding cannot turn normal speed into a speed indicator', () => {
	const projection = projectSpeed(1, 109, 44_100);
	assert.notEqual(projection.stretchFactor, 1);
	assert.equal(projection.speedRatio, 1);
});
