/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sameTrackMeterDisplay } from '../src/common/editor/ui/timeline/TrackTelemetryMeters.tsx';

void test('track meters compare displayed levels and clipping while ignoring other telemetry', () => {
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.2 }, { dbfs: -20, peak: 0.3 }), true);
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.2 }, { dbfs: -19, peak: 0.2 }), false);
	assert.equal(sameTrackMeterDisplay({ dbfs: -20, peak: 0.999 }, { dbfs: -20, peak: 1 }), false);
	assert.equal(sameTrackMeterDisplay({ dbfs: -80, peak: 1 }, { dbfs: -90, peak: 2 }), true);
	assert.equal(sameTrackMeterDisplay(undefined, { dbfs: Number.NaN, peak: 0 }), true);
});
