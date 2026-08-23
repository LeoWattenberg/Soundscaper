/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperSelectedExactFrameExecutionV27 } from '../src/framescaper/selected-v27-exact-frame-execution.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 finishes each straight-alpha source layer in linear light and encodes once', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing(),
	});
	const authority = {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	};
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, authority);
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, signal, assertCurrent() {},
		captureFrame: () => ({
			width: 2, height: 2,
			pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 128
				: index % 4 === 3 ? 255 : 0),
		}),
	});
	const target = new Uint8Array(16);
	const result = await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1)], width: 2, height: 2, target, signal,
	});
	assert.deepEqual([...target.subarray(0, 4)], [128, 0, 0, 255]);
	assert.ok(result.consumedNodeIds.length === 0);
	assert.deepEqual(execution.acceleratorDisposition(), {
		attempted: false, active: false, fallbackReasons: [],
	});
	await execution.dispose();
});

function finishing() {
	return {
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working',
			toneMapping: 'none',
		}],
		sourceColorInterpretations: [{
			schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
			primaries: 'srgb', transfer: 'srgb', matrix: 'rgb', range: 'full',
			provenance: 'user-override',
		}],
		visualPresentations: [{
			schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
			enabled: true, opacity: 0.5, blendMode: 'normal',
			grade: {
				schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
				lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
				saturation: 1, lut: null,
			},
			processorStackId: null, maskMatteIds: [],
		}],
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
