/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	centeredTimelinePlayheadScroll,
	resolveTimelineViewportGeometry,
} from '../src/common/editor/ui/workspace/timeline-navigation-geometry.js';

test('playhead centring accounts for the sticky track panel and clip content offset', () => {
	const original = globalThis.getComputedStyle;
	const timeline = {};
	const scroll = {
		clientWidth: 1_000,
		scrollWidth: 5_000,
		closest: () => timeline,
	};
	globalThis.getComputedStyle = () => ({
		getPropertyValue: (name) => name === '--track-panel-width' ? '200' : '',
	});
	try {
		assert.deepEqual(resolveTimelineViewportGeometry(scroll), {
			panelWidth: 200, viewportWidth: 800,
		});
		assert.equal(centeredTimelinePlayheadScroll(scroll, {
			positionFrame: 480_000, sampleRate: 48_000, pixelsPerSecond: 120,
		}), 812);
	} finally {
		globalThis.getComputedStyle = original;
	}
});
