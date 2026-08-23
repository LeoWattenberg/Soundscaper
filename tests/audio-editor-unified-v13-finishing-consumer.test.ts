/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnifiedExactRenderFinishingExportConsumerV13,
	createUnifiedExactRenderFinishingPreviewConsumerV13,
} from '../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const SOURCE_SHA = '12'.repeat(32);

test('preview and V13 export use the same managed-SDR grade and denoise resolver', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing({
			processors: [{
				schemaVersion: 1, id: 'spatial-1', kind: 'spatial-denoise', enabled: true,
				radius: 1, strength: 1,
			}],
			grade: {
				schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
				lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
				saturation: 1, lut: null,
			},
		}),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const input = rgba(3, 1, [0, 255, 0]);
	const progress: string[] = [];
	const request = {
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0, frame: input,
		onProgress(value: Readonly<{ phase: string }>) { progress.push(value.phase); },
	};
	const preview = createUnifiedExactRenderFinishingPreviewConsumerV13(plan);
	const exporting = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const previewFrame = await preview.resolveFrame(request);
	const exportFrame = await exporting.resolveFrame({ ...request, onProgress: undefined });
	assert.deepEqual(exportFrame.pixels, previewFrame.pixels);
	assert.notDeepEqual(previewFrame.pixels, input.pixels);
	assert.deepEqual(progress, ['spatial-denoise', 'managed-color']);
	assert.equal(preview.plan, exporting.plan);
});

test('similarity stabilization consumes only an authenticated fresh source-domain analysis', async () => {
	const trackingStack = {
		schemaVersion: 1 as const, id: 'stack-1', sourceId: 'video-source',
		processors: [
			{
				schemaVersion: 1 as const, id: 'tracking-1', kind: 'tracking' as const,
				enabled: true, maximumFeatures: 32, quality: 0.01,
				minimumDistance: 2, windowRadius: 2, pyramidLevels: 3,
			},
			{
				schemaVersion: 1 as const, id: 'stabilize-1',
				kind: 'similarity-stabilization' as const, enabled: true,
				motionProvider: 'pyramidal-lucas-kanade' as const,
				analysisId: 'analysis-1', strength: 1,
			},
		],
	};
	const before = square(0, 0);
	const after = square(1, 1);
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA,
		processorStack: trackingStack,
		frames: [{ frameNumber: 0, frame: before }, { frameNumber: 1, frame: after }],
	});
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing({ processors: trackingStack.processors, grade: null }),
			motionAnalyses: [analysis.reference],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const frame = grayRgba(after);
	await assert.rejects(() => consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
	}), /analysis.*body|unavailable|authenticated/iu);
	const stabilized = await consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
		analysisBodies: new Map([['analysis-1', analysis.bytes]]),
	});
	assert.ok(centroidX(stabilized) < centroidX(frame) - 0.5);

	const corrupt = analysis.bytes.slice();
	corrupt[corrupt.length - 2] ^= 1;
	await assert.rejects(() => consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
		analysisBodies: new Map([['analysis-1', corrupt]]),
	}), /digest|analysis body/iu);
});

function finishing(input: Readonly<{ processors: readonly unknown[]; grade: unknown }>) {
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
			enabled: true, opacity: 1, blendMode: 'normal', grade: input.grade,
			processorStackId: 'stack-1', maskMatteIds: [],
		}],
		processorStacks: [{
			schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
			processors: input.processors,
		}],
	};
}

function rgba(width: number, height: number, red: readonly number[]) {
	const pixels = new Uint8Array(width * height * 4);
	red.forEach((value, index) => {
		pixels[index * 4] = value;
		pixels[index * 4 + 1] = value;
		pixels[index * 4 + 2] = value;
		pixels[index * 4 + 3] = 255;
	});
	return { width, height, pixels };
}

function square(dx: number, dy: number) {
	const width = 24;
	const height = 24;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 7 + dy; y < 15 + dy; y += 1) {
		for (let x = 6 + dx; x < 14 + dx; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

function grayRgba(frame: ReturnType<typeof square>) {
	return rgba(frame.width, frame.height, frame.samples.map((value) => Math.round(value * 255)));
}

function centroidX(frame: Readonly<{ width: number; height: number; pixels: Uint8Array }>): number {
	let weighted = 0;
	let total = 0;
	for (let y = 0; y < frame.height; y += 1) {
		for (let x = 0; x < frame.width; x += 1) {
			const value = frame.pixels[(y * frame.width + x) * 4]!;
			weighted += value * x;
			total += value;
		}
	}
	return weighted / total;
}
