/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoTrimServices } from '../src/common/editor/controller/video-trim-composition.ts';

test('video trim composition owns edge, roll/ripple, slip/slide, and rate-stretch services', () => {
	const services = createVideoTrimServices({
		lifetime: { assertActive: () => undefined },
		copy: {
			trimLeftEdgeApplied: 'left {timecode}',
			trimRightEdgeApplied: 'right {timecode}',
			rollLeftEdgeApplied: 'roll left {frames} {sourceTimecode} {programTimecode}',
			rollRightEdgeApplied: 'roll right {frames} {sourceTimecode} {programTimecode}',
			rippleLeftEdgeApplied: 'ripple left {frames} {sourceTimecode} {programTimecode}',
			rippleRightEdgeApplied: 'ripple right {frames} {sourceTimecode} {programTimecode}',
			slipApplied: 'slip {frames} {sourceTimecode}',
			slideApplied: 'slide {frames} {programStartTimecode} {programEndTimecode}',
			rateStretchLeftEdgeApplied: 'stretch left {rate} {timecode}',
			rateStretchRightEdgeApplied: 'stretch right {rate} {timecode}',
			rateStretchBoundaryClamped: 'stretch clamped',
			noRateStretchAvailable: 'no stretch',
			trimBoundaryClamped: 'clamped',
			noTrimAvailable: 'none',
		},
		getProject: () => null,
		getTimingViews: () => Object.freeze(new Map()),
		editingBlocked: () => false,
		commit: () => undefined,
		label: (sample) => `program:${String(sample)}`,
		sourceLabel: (sourceId, frame) => `${sourceId}:${String(frame)}`,
		setStatus: () => undefined,
	});

	assert.deepEqual(Object.keys(services), ['edge', 'rollRipple', 'slipSlide', 'rateStretch']);
	assert.equal(Object.isFrozen(services), true);
	for (const service of Object.values(services)) {
		assert.equal(typeof service.preview, 'function');
		assert.equal(typeof service.commit, 'function');
		assert.equal(Object.isFrozen(service), true);
	}
	assert.equal(typeof services.slipSlide.capturePointerAuthority, 'function');
});
