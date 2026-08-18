/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_CANVAS_FIT_MODES,
	isVideoCanvasFit,
	resolveVideoCanvasPlacement,
} from '../src/common/editor/video-canvas-fit.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

const LANDSCAPE = Object.freeze({ width: 1920, height: 1080 });
const VERTICAL = Object.freeze({ width: 1080, height: 1920 });

function describe(canvas: Record<string, unknown>) {
	return resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: LANDSCAPE,
		canvas: canvas as never,
	});
}

test('contain leaves the whole source inside the canvas, with bars for the rest', () => {
	const placement = resolveVideoCanvasPlacement('contain', 1080, 1920, 1920, 1080);
	assert.deepEqual(placement, { fittedWidth: 1080, fittedHeight: 608, fittedX: 0, fittedY: 656 });
	assert.ok(placement.fittedWidth <= 1080 && placement.fittedHeight <= 1920);
});

test('cover fills the canvas and lets the overflow fall outside it', () => {
	// A 16:9 master delivered 9:16 has to lose its sides; that is the crop, and
	// the placement says so by starting left of the canvas.
	const placement = resolveVideoCanvasPlacement('cover', 1080, 1920, 1920, 1080);
	assert.deepEqual(placement, { fittedWidth: 3413, fittedHeight: 1920, fittedX: -1166, fittedY: 0 });
	assert.ok(placement.fittedWidth >= 1080 && placement.fittedHeight >= 1920);
});

test('stretch fills the canvas exactly and gives up the aspect to do it', () => {
	assert.deepEqual(
		resolveVideoCanvasPlacement('stretch', 1080, 1920, 1920, 1080),
		{ fittedWidth: 1080, fittedHeight: 1920, fittedX: 0, fittedY: 0 },
	);
});

test('a canvas the source already matches places identically whatever the fit', () => {
	const placements = VIDEO_CANVAS_FIT_MODES.map(
		(fit) => resolveVideoCanvasPlacement(fit, 1920, 1080, 1920, 1080),
	);
	for (const placement of placements) {
		assert.deepEqual(placement, { fittedWidth: 1920, fittedHeight: 1080, fittedX: 0, fittedY: 0 });
	}
});

test('an absent fit is the placement every canvas meant before delivery fit existed', () => {
	const before = describe({ ...VERTICAL });
	const contain = describe({ ...VERTICAL, fit: 'contain' });
	assert.deepEqual(before, contain, 'byte-stable for anything that does not ask');
	assert.deepEqual([...before.sourceDisplayToCanvas].slice(4), [0, 656], 'centred with bars above and below');
});

test('the render description places by the fit its canvas names', () => {
	const cover = describe({ ...VERTICAL, fit: 'cover' });
	const [a, , , d, e, f] = cover.sourceDisplayToCanvas;
	// One scale on both axes, to within the pixel rounding the fitted extents
	// have always carried — `contain` shows the same 0.5625 against 0.562963.
	assert.ok(a > 1.7 && Math.abs(a - d) < 1e-3, 'one scale, applied to both axes');
	assert.equal(f, 0, 'the full height is used');
	assert.ok(e < 0, 'and the sides fall outside the canvas');

	const stretch = describe({ ...VERTICAL, fit: 'stretch' });
	const [stretchA, , , stretchD] = stretch.sourceDisplayToCanvas;
	assert.ok(stretchD > stretchA, 'a 9:16 canvas stretches a landscape source vertically');
});

test('an unknown fit is refused rather than silently contained', () => {
	assert.equal(isVideoCanvasFit('crop'), false);
	assert.throws(() => resolveVideoCanvasPlacement('crop' as never, 10, 10, 10, 10), /Unsupported video canvas fit/u);
	assert.throws(() => describe({ ...VERTICAL, fit: 'crop' }), /canvas fit is unsupported/u);
	for (const bad of [0, -1, Number.NaN]) {
		assert.throws(
			() => resolveVideoCanvasPlacement('contain', bad, 10, 10, 10),
			/must be positive/u,
			String(bad),
		);
	}
});
