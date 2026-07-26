/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaveformPreviewCacheKey } from '../src/common/editor/ui/waveform-preview-cache.ts';

const base = {
	source: { id: 'source', storageKey: 'pcm/source', revision: 3 },
	clip: {
		id: 'clip', sourceId: 'source', revision: 8, timelineStartFrame: 0,
		sourceStartFrame: 20, sourceDurationFrames: 100, durationFrames: 100,
		envelope: [{ frame: 0, value: 1 }, { frame: 100, value: 0.75 }],
	},
	sourceWindow: { startFrame: 20, endFrame: 120 },
	rendering: {
		showRms: false, halfWave: false, pixelsPerSecond: 120, pixelWidth: 240,
		reuseSummaryForCompatibility: false, provideAudacitySpectrogram: false,
	},
} as const;

test('waveform cache keys are stable for equivalent source, clip, and window values', () => {
	assert.equal(createWaveformPreviewCacheKey(base), createWaveformPreviewCacheKey({
		...base,
		source: { ...base.source },
		clip: { ...base.clip, envelope: base.clip.envelope.map((point) => ({ ...point })) },
	}));
});

test('waveform cache keys invalidate on source revision, clip revision, or source window changes', () => {
	const key = createWaveformPreviewCacheKey(base);
	assert.notEqual(key, createWaveformPreviewCacheKey({ ...base, source: { ...base.source, revision: 4 } }));
	assert.notEqual(key, createWaveformPreviewCacheKey({ ...base, clip: { ...base.clip, revision: 9 } }));
	assert.notEqual(key, createWaveformPreviewCacheKey({
		...base,
		clip: { ...base.clip, envelope: [{ frame: 0, value: 1 }, { frame: 100, value: 0.5 }] },
	}));
	assert.notEqual(key, createWaveformPreviewCacheKey({ ...base, sourceWindow: { startFrame: 21, endFrame: 120 } }));
});
