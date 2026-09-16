/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';

// Audacity 4c177d4: au3/libraries/au3-dynamic-range-processor/DynamicRangeProcessorTypes.h.

test('new Audacity dynamics effects use the pinned Qt defaults shown by their dials', () => {
	assert.deepEqual(audacityEffectDefaults('audacity-compressor'), {
		thresholdDb: -12, makeupGainDb: 9, kneeWidthDb: 6, ratio: 4,
		lookaheadMs: 3, attackMs: 3, releaseMs: 100,
	});
	assert.deepEqual(audacityEffectDefaults('audacity-limiter'), {
		thresholdDb: -6, makeupTargetDb: -1, kneeWidthDb: 2, lookaheadMs: 1, releaseMs: 20,
	});
});
