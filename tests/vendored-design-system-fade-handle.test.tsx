/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackFadeHandle } from '../vendor/audacity-design-system/components/src/Track/TrackFadeHandle.tsx';

function renderHandle(edge: 'in' | 'out', boundaryX: number, oppositeBoundaryX: number, clipWidth = 400): string {
	return renderToStaticMarkup(<TrackFadeHandle edge={edge} boundaryX={boundaryX}
		oppositeBoundaryX={oppositeBoundaryX} clipWidth={clipWidth} aria-label={`Fade ${edge}`}
		aria-valuemin={0} aria-valuemax={4} aria-valuenow={1} tabIndex={-1}
		data-clip-fade-handle={edge} title={`Fade ${edge}`} />);
}

test('fade handles retain the design-system glyph and accessible host props', () => {
	const incoming = renderHandle('in', 100, 300);
	const outgoing = renderHandle('out', 300, 100);
	assert.match(incoming, /<button[^>]*type="button"[^>]*role="slider"/u);
	assert.match(incoming, /class="audacity-track-fade-handle"/u);
	assert.match(incoming, /data-fade-handle="in"/u);
	assert.match(incoming, /data-clip-fade-handle="in"/u);
	assert.match(incoming, /aria-label="Fade in"/u);
	assert.match(incoming, /aria-valuemax="4"/u);
	assert.match(incoming, /tabindex="-1"/u);
	assert.match(incoming, /style="left:96px"/u);
	assert.match(incoming, /M15\.5 6\.5V15\.5H6\.5V6\.5H15\.5Z/u);
	assert.match(outgoing, /style="left:289px"/u);
	assert.match(outgoing, /transform:scaleX\(-1\)/u);
});

test('fade handles retreat into their own regions when boundaries approach and stay inside the clip', () => {
	assert.match(renderHandle('in', 190, 210), /style="left:173px"/u);
	assert.match(renderHandle('out', 210, 190), /style="left:212px"/u);
	assert.match(renderHandle('in', 200, 216), /style="left:183px"/u);
	assert.match(renderHandle('out', 216, 200), /style="left:218px"/u);
	assert.match(renderHandle('in', 0, 400), /style="left:0"/u);
	assert.match(renderHandle('out', 400, 0), /style="left:384px"/u);
	assert.equal(renderHandle('in', 0, 40, 40), '');
	assert.notEqual(renderHandle('in', 0, 64, 64), '');
});

test('coincident and crossed boundaries keep both 16px targets independently reachable', () => {
	const pair = (inBoundary: number, outBoundary: number, clipWidth = 400) => {
		const incoming = renderHandle('in', inBoundary, outBoundary, clipWidth);
		const outgoing = renderHandle('out', outBoundary, inBoundary, clipWidth);
		const inLeft = Number(incoming.match(/style="left:(\d+)(?:px)?"/u)?.[1]);
		const outLeft = Number(outgoing.match(/style="left:(\d+)(?:px)?"/u)?.[1]);
		assert.ok(Number.isFinite(inLeft));
		assert.ok(Number.isFinite(outLeft));
		assert.ok(Math.abs(inLeft - outLeft) >= 16, `targets overlap at ${inBoundary}/${outBoundary}`);
		assert.ok(inLeft >= 0 && inLeft + 16 <= clipWidth);
		assert.ok(outLeft >= 0 && outLeft + 16 <= clipWidth);
		return [inLeft, outLeft];
	};
	assert.deepEqual(pair(200, 200), [183, 202]);
	assert.deepEqual(pair(210, 190), [202, 184]);
	assert.deepEqual(pair(0, 0), [0, 18]);
	assert.deepEqual(pair(400, 400), [366, 384]);
	assert.deepEqual(pair(18, 2, 64), [0, 18]);
	assert.deepEqual(pair(62, 46, 64), [30, 48]);
});
