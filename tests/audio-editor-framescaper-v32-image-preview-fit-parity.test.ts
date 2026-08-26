/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { VIDEO_CANVAS_FIT_MODES } from '../src/common/editor/video-canvas-fit.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

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

test('the V32 image preview composites through the delivery fit, as the export does', async () => {
	const [preview, execution, panel, hook, runtime] = await Promise.all([
		readFile(new URL('src/framescaper/editor-selected-v32-image-preview.ts', ROOT), 'utf8'),
		readFile(new URL('src/framescaper/video-export-image-execution-v32.ts', ROOT), 'utf8'),
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
