/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bindFramescaperUnifiedRenderTimingSidecarsV27 } from '../src/framescaper/editor-project-unified-render-timing-v27.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperSelectedExactFrameExecutionV27 } from '../src/framescaper/selected-v27-exact-frame-execution.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 decodes canvas-captured media as canvas sRGB regardless of the file tags', async () => {
	// The browser already expanded limited range and converted the transfer
	// while drawing the video into the capture canvas, so a BT.709
	// limited-tagged source must not be range-expanded or EOTF-decoded a
	// second time from its readback bytes.
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing(),
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
				provenance: 'default-video-bt709-limited',
			}],
			visualPresentations: [],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	});
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, renderAuthority(project, 10).timingViews,
		), signal, assertCurrent() {},
		captureFrame: () => rgbaFrame(128),
	});
	const target = new Uint8Array(16);
	await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1)], width: 2, height: 2, target, signal,
	});
	assert.deepEqual(
		[...target.subarray(0, 4)], [128, 0, 0, 255],
		'mid-gray readback survives managed color unshifted',
	);
	await execution.dispose();
});

function finishing() {
	return {
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working',
			toneMapping: 'none',
		}],
		sourceColorInterpretations: [], visualPresentations: [],
		processorStacks: [], motionAnalyses: [],
	};
}

function mediaLayer(clipId: string, opacity: number) {
	return {
		trackId: 'video-track', trackIndex: 0, entries: [{
			kind: 'video', role: 'single', clipId, sourceId: 'video-source',
			presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
			video: { videoWidth: 2, videoHeight: 2 },
			displayWidth: 2, displayHeight: 2, effects: [], intervalProgress: 0,
			renderDescription: resolveVideoRenderDescription({
				composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				sourceDisplaySize: { width: 2, height: 2 },
				canvas: { width: 2, height: 2 }, opacityStart: opacity,
			}),
		}],
	};
}

function rgbaFrame(red: number) {
	return Object.freeze({
		width: 2, height: 2,
		pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? red
			: index % 4 === 3 ? 255 : 0),
	});
}
