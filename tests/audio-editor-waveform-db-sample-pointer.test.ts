/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';

test('sample pencil converts logarithmic screen positions back to signed audio amplitudes', () => {
	const lane = {
		dataset: { waveformRulerFormat: 'logarithmic-db', channelBodyTop: '20' },
		getBoundingClientRect: () => ({ height: 124, top: 0 }),
	};
	for (const [clientY, expected] of [[22, 1], [47, 10 ** (-30 / 20)], [72, 0], [97, -(10 ** (-30 / 20))], [122, -1]]) {
		const point = samplePointAtPointer(
			{ clientX: 10, clientY }, lane,
			{ timelineStartFrame: 0, durationFrames: 10 }, { channelCount: 1 }, () => 5,
		);
		assert.ok(Math.abs(point.value - expected!) < 1e-12, `y=${String(clientY)} should draw ${String(expected)}`);
		assert.equal(point.timelineFrame, 5);
	}
});

test('dB pencil mapping follows half-wave geometry and vertical zoom', () => {
	const lane = {
		dataset: { waveformRulerFormat: 'logarithmic-db', waveformZoom: '1', halfWave: 'true' },
		getBoundingClientRect: () => ({ height: 104, top: 0 }),
	};
	const point = samplePointAtPointer(
		{ clientX: 10, clientY: 2 }, lane,
		{ timelineStartFrame: 0, durationFrames: 10 }, { channelCount: 1 }, () => 5,
	);
	assert.ok(Math.abs(point.value - 10 ** (-30 / 20)) < 1e-12);
	assert.equal(samplePointAtPointer(
		{ clientX: 10, clientY: 104 }, lane,
		{ timelineStartFrame: 0, durationFrames: 10 }, { channelCount: 1 }, () => 5,
	).value, 0, 'the bottom padding of a half-wave channel cannot draw negative samples');
});
