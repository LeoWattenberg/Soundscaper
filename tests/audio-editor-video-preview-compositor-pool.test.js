/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	clearVideoPreviewCompositorLayer,
	primeVideoPreviewCompositorPool,
	synchronizeVideoPreviewCompositorLayers,
} from '../src/common/editor/ui/workspace/video-preview-compositor-pool.js';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

test('preview resolves its reference canvas before opting both timeline views into descriptions', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		import.meta.url,
	), 'utf8');
	assert.ok(source.indexOf('const referenceCanvas = useMemo') < source.indexOf('const layers = useMemo'));
	assert.match(source, /resolveActiveVideoLayers\(project, positionFrame, \{ renderCanvas: referenceCanvas \}\)/u);
	assert.match(source, /resolveVideoCompositionIntervals\(project, \{ renderCanvas \}\)/u);
	assert.match(source, /failedVideoSourcesRef\.current,\s*referenceCanvas,/u);
});

test('preview pool carries canonical render descriptions into entries and layer blend state', () => {
	const renderDescription = resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			opacity: 0.5,
			blendMode: 'multiply',
		},
		sourceDisplaySize: { width: 640, height: 360 },
		canvas: { width: 1_280, height: 720 },
		opacityStart: 0,
		opacityEnd: 1,
	});
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const video = { readyState: 4, videoWidth: 640, videoHeight: 360 };
	const timeline = compositionTimeline({ renderDescription });

	assert.equal(synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		timeline,
		5,
		new Map([['clip', video]]),
		effectBypass(),
		new Map(),
	), true);
	assert.equal(targetLayers.length, 1);
	assert.equal(targetLayers[0].blendMode, 'multiply');
	assert.strictEqual(targetLayers[0].entries[0].renderDescription, renderDescription);
	assert.equal(targetLayers[0].entries[0].intervalProgress, 0.5);
	assert.equal(targetLayers[0].entries[0].opacity, 0.5);
});

test('preview pool removes render fields when a legacy descriptor is absent or a layer clears', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const entry = layerPool[0].entryPool[0];
	entry.renderDescription = { stale: true };
	entry.intervalProgress = 0.75;
	layerPool[0].blendMode = 'screen';

	synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		compositionTimeline({}),
		5,
		new Map([['clip', { readyState: 4, videoWidth: 640, videoHeight: 360 }]]),
		effectBypass(),
		new Map(),
	);
	assert.equal(Object.hasOwn(entry, 'renderDescription'), false);
	assert.equal(Object.hasOwn(entry, 'intervalProgress'), false);
	assert.equal(Object.hasOwn(layerPool[0], 'blendMode'), false);

	entry.renderDescription = { stale: true };
	entry.intervalProgress = 0.25;
	layerPool[0].blendMode = 'overlay';
	clearVideoPreviewCompositorLayer(layerPool[0]);
	assert.equal(Object.hasOwn(entry, 'renderDescription'), false);
	assert.equal(Object.hasOwn(entry, 'intervalProgress'), false);
	assert.equal(Object.hasOwn(layerPool[0], 'blendMode'), false);
});

function compositionTimeline(clipFields) {
	return {
		clipStateById: new Map([['clip', { available: true }]]),
		intervals: [{
			kind: 'composition',
			timelineStartFrame: 0,
			timelineEndFrame: 10,
			layers: [{
				trackId: 'video-track',
				clips: [{
					clipId: 'clip',
					clip: { videoEffects: [] },
					source: { id: 'source', width: 640, height: 360 },
					opacityStart: 0,
					opacityEnd: 1,
					...clipFields,
				}],
			}],
		}],
	};
}

function effectBypass() {
	return { effectsFor: (_clipId, effects) => effects };
}
