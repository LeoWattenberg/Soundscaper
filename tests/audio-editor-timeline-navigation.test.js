/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	accumulateTimelineZoomWheel,
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

test('trackpad pinch deltas accumulate to one bounded timeline zoom step', () => {
	let state;
	const zooms = [];
	for (let index = 0; index < 12; index += 1) {
		const result = accumulateTimelineZoomWheel(state, {
			deltaY: -4, deltaMode: 0, timeStamp: index * 8,
		}, 800);
		state = result.state;
		if (result.zoom) zooms.push(result.zoom);
	}
	assert.deepEqual(zooms, ['in']);

	const reversed = accumulateTimelineZoomWheel(state, {
		deltaY: 4, deltaMode: 0, timeStamp: 100,
	}, 800);
	assert.equal(reversed.zoom, null, 'a direction change starts a fresh notch');
	const discrete = accumulateTimelineZoomWheel(reversed.state, {
		deltaY: 100, deltaMode: 0, timeStamp: 110,
	}, 800);
	assert.equal(discrete.zoom, 'out');
	assert.equal(discrete.state.delta, 0, 'one event cannot queue compounding follow-up steps');
});
