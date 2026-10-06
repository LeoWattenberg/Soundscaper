/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sameTrackMeterDisplay } from '../src/common/editor/ui/timeline/TrackTelemetryMeters.tsx';
import type { StripMeterSnapshot } from '../src/common/editor/production-audio/strip-meter-session.ts';

function stripMeter(peaks: readonly number[]): StripMeterSnapshot {
	return { strip: { kind: 'track', id: 'track' }, sequence: 1, channelCount: peaks.length,
		channels: peaks.map((peak, index) => ({ label: String(index), peak, rms: peak / Math.SQRT2 })),
		correlation: null, phaseDegrees: null };
}

void test('track meters compare displayed levels and clipping while ignoring other telemetry', () => {
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.2 }, { dbfs: -20, peak: 0.3 }), true);
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.2 }, { dbfs: -19, peak: 0.2 }), false);
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.999 }, { dbfs: -20, peak: 1 }), false);
	assert.equal(sameTrackMeterDisplay({ dbfs: -80, peak: 1 }, { dbfs: -90, peak: 2 }), true);
	assert.equal(sameTrackMeterDisplay(undefined, { dbfs: Number.NaN, peak: 0 }), true);
});

void test('display comparison retains independent production channel levels and full-scale clipping', () => {
	assert.equal(sameTrackMeterDisplay(stripMeter([0.8, 0]), stripMeter([0.8, 0.1])), false);
	assert.equal(sameTrackMeterDisplay(stripMeter([0.8, 0.1]), stripMeter([0.8, 0])), false);
	assert.equal(sameTrackMeterDisplay(stripMeter([0.99, 0]), stripMeter([1, 0])), false);
	assert.equal(sameTrackMeterDisplay(stripMeter([0, 0.99]), stripMeter([0, 1])), false);
	const left = stripMeter([0.8, 0.2]);
	const right = { ...left, sequence: 2, correlation: 0.5,
		channels: left.channels.map(channel => ({ ...channel, rms: 0.001 })) };
	assert.equal(sameTrackMeterDisplay(left, right), true, 'non-displayed metrics do not publish new leaves');
	assert.equal(sameTrackMeterDisplay(stripMeter([0.8]), stripMeter([0.8, 0.8])), true);
	assert.equal(sameTrackMeterDisplay(stripMeter([0.8, 0.2, 1]), stripMeter([0.8, 0.2, 0])), true);
});

void test('scalar fallback clipping follows the same full-scale rule as the rendered readings', () => {
	assert.equal(sameTrackMeterDisplay({ dbfs: 0 }, { dbfs: 0, peak: 0.9 }), false);
	assert.equal(sameTrackMeterDisplay({ dbfs: 0 }, { dbfs: 0, peak: 1 }), true);
	assert.equal(sameTrackMeterDisplay(undefined, stripMeter([0, 0])), true);
});
