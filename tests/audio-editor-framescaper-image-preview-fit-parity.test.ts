/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { VIDEO_CANVAS_FIT_MODES } from '../src/common/editor/video-canvas-fit.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { placeUnifiedExactLinearRgbaFrameV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import { resolveFramescaperVisualPlacementFinishing } from '../src/framescaper/visual-placement-finishing.ts';

const ROOT = new URL('../', import.meta.url);

/**
 * Playback and export are the same render. A portrait image on a landscape
 * delivery is placed entirely differently under each fit, so previewing one fit
 * while exporting another shows the operator a frame they will not get.
 */
test('every delivery fit places a timeline image differently, so the preview must carry it', () => {
	const placements = VIDEO_CANVAS_FIT_MODES.map((fit) => resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: { width: 1_080, height: 1_920 },
		canvas: { width: 1_920, height: 1_080, fit },
		opacityStart: 1,
	}));

	assert.equal(
		new Set(placements.map((placement) => JSON.stringify(placement))).size,
		VIDEO_CANVAS_FIT_MODES.length,
		'each fit is a distinct placement, so defaulting the preview to contain is visible',
	);
});

test('the baseline image preview composites through the delivery fit, as the export does', async () => {
	const [preview, execution, panel, hook, runtime] = await Promise.all([
		readFile(new URL('src/framescaper/editor-selected-timeline-image-image-preview.ts', ROOT), 'utf8'),
		readFile(new URL('src/framescaper/video-export-image-execution-timeline-image.ts', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/workspace/VideoPreviewPanel.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/workspace/use-product-video-visual-preview-session.ts', ROOT), 'utf8'),
		readFile(new URL('src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts', ROOT), 'utf8'),
	]);

	assert.match(execution, /fit: options\.foundationPlan\.output\.canvas\.fit/u);
	assert.match(runtime, /readonly fit\?: VideoCanvasFit;/u);
	assert.match(panel, /fit: referenceCanvas\.fit/u);
	assert.match(hook, /\.\.\.\(options\.fit === undefined \? \{\} : \{ fit: options\.fit \}\)/u);
	assert.match(preview, /previewCanvas\(options\?\.width, options\?\.height, options\?\.fit\)/u);
	assert.match(preview, /\.\.\.\(fit === undefined \? \{\} : \{ fit \}\)/u);
});

test('the finishing visual preview preserves the selected delivery fit', async () => {
	const preview = await readFile(
		new URL('src/framescaper/editor-selected-finishing-visual-preview.ts', ROOT),
		'utf8',
	);

	assert.match(preview, /previewCanvas\(options\.width, options\.height, options\.fit\)/u);
	assert.match(preview, /\.\.\.\(fit === undefined \? \{\} : \{ fit \}\)/u);
	assert.doesNotMatch(preview, /canvas: \{ \.\.\.canvas, fit: 'contain'/u);
});

test('finishing playback, exact preview, and export share one visual placement', async () => {
	const [playback, exact, exportExecution] = await Promise.all([
		readFile(new URL('src/framescaper/editor-selected-finishing-visual-preview.ts', ROOT), 'utf8'),
		readFile(new URL('src/framescaper/selected-finishing-exact-frame-execution.ts', ROOT), 'utf8'),
		readFile(new URL('src/framescaper/video-export-visual-execution-finishing.ts', ROOT), 'utf8'),
	]);

	for (const source of [playback, exact, exportExecution]) {
		assert.match(source, /resolveFramescaperVisualPlacementFinishing/u);
	}
	assert.doesNotMatch(exact, /renderDescription: identityDescription\(width, height, entry\.blendMode\)/u);
	assert.doesNotMatch(exportExecution, /renderDescription: identityDescription\(width, height, entry\.blendMode\)/u);
});

test('the shared finishing placement preserves portrait geometry for exact output', () => {
	const entry = {
		modelKind: 'still', opacity: 1, blendMode: 'normal',
		authoredState: { source: { width: 2, height: 4 } },
	} as never;
	const frame = Object.freeze({
		width: 2, height: 4,
		pixels: new Uint8Array(2 * 4 * 4).fill(255),
	});
	const alphaAt = (fit: 'contain' | 'cover' | 'stretch', x: number, y: number) => {
		const placement = resolveFramescaperVisualPlacementFinishing(entry, { width: 8, height: 4, fit });
		const output = placeUnifiedExactLinearRgbaFrameV13({
			frame,
			displayWidth: placement.width,
			displayHeight: placement.height,
			outputWidth: 8,
			outputHeight: 4,
			renderDescription: placement.renderDescription,
		});
		return output.pixels[(y * 8 + x) * 4 + 3];
	};

	assert.equal(alphaAt('contain', 0, 0), 0, 'contain must retain side bars');
	assert.equal(alphaAt('contain', 3, 0), 1, 'contain must retain the portrait pixels');
	assert.equal(alphaAt('cover', 0, 0), 1, 'cover must fill by cropping');
	assert.equal(alphaAt('stretch', 0, 0), 1, 'stretch must fill by reframing');
});
