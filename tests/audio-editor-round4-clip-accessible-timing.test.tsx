/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { toDesignRecordingPreview } from '../src/common/editor/ui/timeline/preview.ts';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';

function accessibleName(clip: { id: string; name: string; start: number; duration: number }): string {
	const markup = renderToStaticMarkup(<TrackNew clips={[clip]} trackIndex={0} width={800} />);
	const match = /data-clip-id="[^"]+"[^>]*aria-label="([^"]+)"/u.exec(markup);
	assert.ok(match, 'the timeline clip has an accessible name');
	return match[1];
}

for (const startFrame of [0, 480_000]) {
	test(`clip accessible timing keeps the authored interval at frame ${startFrame}`, () => {
		const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: startFrame,
			durationFrames: 9600, sourceStartFrame: 0, sourceDurationFrames: 9600,
			waveformStartFrame: 0, waveformEndFrame: 9600 };
		const model = createTimelineClipViewModel({
			controller: { getClipVisualData: () => null }, sourceLookup: new Map([['source', { name: 'Recording', sampleRate: 48_000 }]]),
			clip, geometry: { overscanStartFrame: startFrame, pixelsPerSecond: 120, sampleRate: 48_000 },
			selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: {},
		});
		assert.equal(model.start, 0, 'the painted interval remains relative to the viewport');
		assert.equal(model.duration, 0.4, 'minimum visual width remains available for editing');
		assert.equal(accessibleName(model), `Recording clip, starts at ${startFrame ? '10 seconds' : '0 seconds'}, 0.2 seconds long`);
	});
}

test('recording preview announces elapsed audio without inflating its editing hit area', () => {
	const model = toDesignRecordingPreview({ id: 'preview', timelineStartFrame: 96_000,
		durationFrames: 4800, waveformStartFrame: 0, waveformEndFrame: 4800 }, null, 96_000, 120, 48_000,
	{ recordingLabel: 'Recording' });
	assert.equal(model.start, 0);
	assert.equal(model.duration, 0.4);
	assert.equal(accessibleName(model), 'Recording clip, starts at 2 seconds, 0.1 seconds long');
});

test('standalone design-system clips retain their ordinary seconds contract', () => {
	assert.equal(accessibleName({ id: 'standalone', name: 'Clip', start: 2, duration: 1 }),
		'Clip clip, starts at 2 seconds, 1 second long');
});
