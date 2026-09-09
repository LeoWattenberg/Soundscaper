/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';

import { TimelineRulerCanvas } from '../src/common/editor/ui/timeline/TimelineRulerCanvas.jsx';

Object.assign(globalThis, { React });

const baseProps = {
	contentScrollX: 0,
	controller: { actions: { transport: { toggleLoop() {} } } },
	durationSeconds: 10,
	loopPreview: null,
	markerLaneVisible: false,
	pixelsPerSecond: 100,
	project: { loop: { enabled: false, startFrame: 0, endFrame: 0 } },
	rulerScale: { kind: 'minutes-seconds' },
	run(callback: () => void) { callback(); },
	sampleRate: 48_000,
	timeSelection: null,
	timelineWidth: 1_000,
	viewportWidth: 800,
};

test('the timeline ruler represents an empty loop range as absent', () => {
	// Render under React so the ruler can resolve its theme and skin contexts.
	function Probe() {
		const empty = TimelineRulerCanvas({
			...baseProps,
			displayedLoop: { startFrame: 0, endFrame: 0 },
		});
		assert.equal(empty.props.loopRegionStart, null);
		assert.equal(empty.props.loopRegionEnd, null);

		const loop = TimelineRulerCanvas({
			...baseProps,
			displayedLoop: { startFrame: 0, endFrame: 48_000 },
		});
		assert.equal(loop.props.loopRegionStart, 0);
		assert.equal(loop.props.loopRegionEnd, 1);
		return null;
	}
	renderToStaticMarkup(<ThemeProvider><Probe /></ThemeProvider>);
});
