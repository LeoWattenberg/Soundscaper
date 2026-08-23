/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	requireFreshVideoMotionAnalysisV1,
} from '../src/common/editor/video-motion-model-v27.ts';
import {
	applySimilarityTransformV1,
	createGrayVideoFrameV1,
	detectShiTomasiFeaturesV1,
	estimateSimilarityRansacV1,
	resolveStabilizationTransformV1,
	trackPyramidalLucasKanadeV1,
} from '../src/common/editor/video-motion-processing-v27.ts';
import { processTemporalDenoiseV1 } from '../src/common/editor/video-motion-denoise-v27.ts';

const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);

function translatedDot(dx: number, dy: number): ReturnType<typeof createGrayVideoFrameV1> {
	const width = 16;
	const height = 16;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 5 + dy; y < 10 + dy; y += 1) {
		for (let x = 4 + dx; x < 9 + dx; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

test('processor stacks are closed, bounded, and keep optical flow out of retime', () => {
	const stack = normalizeVideoProcessorStackV1({
		schemaVersion: 1,
		id: 'stack-1',
		sourceId: 'video-1',
		processors: [
			{
				schemaVersion: 1,
				id: 'track-1',
				kind: 'tracking',
				enabled: true,
				maximumFeatures: 128,
				quality: 0.05,
				minimumDistance: 3,
				windowRadius: 3,
				pyramidLevels: 3,
			},
			{
				schemaVersion: 1,
				id: 'stabilize-1',
				kind: 'similarity-stabilization',
				enabled: true,
				motionProvider: 'pyramidal-lucas-kanade',
				analysisId: 'analysis-1',
				strength: 1,
			},
			{
				schemaVersion: 1,
				id: 'denoise-1',
				kind: 'temporal-denoise',
				enabled: true,
				motionProvider: 'pyramidal-lucas-kanade',
				analysisId: 'analysis-1',
				radius: 1,
				strength: 0.5,
			},
		],
	});
	assert.equal(stack.processors.length, 3);
	assert.equal(Object.isFrozen(stack.processors), true);
	assert.throws(() => normalizeVideoProcessorStackV1({
		...stack,
		processors: [{
			schemaVersion: 1,
			id: 'retime-1',
			kind: 'retime-interpolation',
			enabled: true,
			motionProvider: 'pyramidal-lucas-kanade',
		}],
	}), /processor|unsupported|retime/iu);
});

test('motion analysis references are digest-bound and stale inputs refuse export', () => {
	const analysis = normalizeVideoMotionAnalysisReferenceV1({
		schemaVersion: 1,
		id: 'analysis-1',
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_A,
		settingsSha256: SHA_B,
		storageKey: `motion-sha256:${SHA_B}`,
		sha256: SHA_B,
		byteLength: 4096,
		startFrame: 0,
		endFrame: 240,
	});
	assert.equal(requireFreshVideoMotionAnalysisV1(analysis, {
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_A,
		settingsSha256: SHA_B,
	}).id, 'analysis-1');
	assert.throws(() => requireFreshVideoMotionAnalysisV1(analysis, {
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_B,
		settingsSha256: SHA_B,
	}), /stale|input digest/iu);
});

test('Shi-Tomasi features and pyramidal Lucas-Kanade tracks are deterministic', () => {
	const before = translatedDot(0, 0);
	const after = translatedDot(1, 1);
	const first = detectShiTomasiFeaturesV1(before, {
		maximumFeatures: 8,
		quality: 0.01,
		minimumDistance: 2,
	});
	const second = detectShiTomasiFeaturesV1(before, {
		maximumFeatures: 8,
		quality: 0.01,
		minimumDistance: 2,
	});
	assert.deepEqual(first, second);
	assert.ok(first.length >= 2);

	const tracked = trackPyramidalLucasKanadeV1(before, after, first, {
		windowRadius: 2,
		pyramidLevels: 3,
		maximumIterations: 12,
		epsilon: 1e-4,
	});
	const accepted = tracked.filter((item) => item.status === 'tracked');
	assert.ok(accepted.length >= 2);
	for (const item of accepted) {
		assert.ok(Math.abs((item.target.x - item.source.x) - 1) < 0.25);
		assert.ok(Math.abs((item.target.y - item.source.y) - 1) < 0.25);
	}
});

test('deterministic RANSAC recovers a similarity transform and ignores an outlier', () => {
	const transform = estimateSimilarityRansacV1([
		{ source: { x: 0, y: 0 }, target: { x: 4, y: -2 }, confidence: 1 },
		{ source: { x: 2, y: 0 }, target: { x: 4, y: 0 }, confidence: 1 },
		{ source: { x: 0, y: 2 }, target: { x: 2, y: -2 }, confidence: 1 },
		{ source: { x: 2, y: 2 }, target: { x: 2, y: 0 }, confidence: 1 },
		{ source: { x: 8, y: 8 }, target: { x: -50, y: 42 }, confidence: 0.1 },
	], { inlierThreshold: 0.01, minimumInliers: 4 });
	assert.equal(transform.inlierCount, 4);
	assert.ok(Math.abs(transform.scale - 1) < 1e-9);
	assert.ok(Math.abs(transform.rotationRadians - Math.PI / 2) < 1e-9);
	const mapped = applySimilarityTransformV1({ x: 2, y: 2 }, transform);
	assert.ok(Math.abs(mapped.x - 2) < 1e-9);
	assert.ok(Math.abs(mapped.y) < 1e-9);

	const stabilization = resolveStabilizationTransformV1(transform, 1);
	const stable = applySimilarityTransformV1(mapped, stabilization);
	assert.ok(Math.abs(stable.x - 2) < 1e-9);
	assert.ok(Math.abs(stable.y - 2) < 1e-9);
});

test('temporal denoise admits GPU-first output and computes CPU only after accelerator failure', async () => {
	const current = createGrayVideoFrameV1({ width: 2, height: 2, samples: [1, 1, 1, 1] });
	const neighbor = createGrayVideoFrameV1({ width: 2, height: 2, samples: [0, 0, 0, 0] });
	const neighbors = [{ frame: neighbor, transformToCurrent: {
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 4, meanError: 0,
	} }];
	const cpu = await processTemporalDenoiseV1({
		current, neighbors, strength: 0.5,
	});
	assert.deepEqual(cpu.samples, [0.75, 0.75, 0.75, 0.75]);

	const accelerated = await processTemporalDenoiseV1({
		current, neighbors,
		strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				return createGrayVideoFrameV1({ width: 2, height: 2, samples: [0.25, 0.25, 0.25, 0.25] });
			},
		},
	});
	assert.deepEqual(accelerated.samples, [0.25, 0.25, 0.25, 0.25]);

	let fallbackReason = '';
	const fallback = await processTemporalDenoiseV1({
		current, neighbors,
		strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				throw new Error('context lost');
			},
		},
		onAcceleratorFallback(reason) { fallbackReason = reason; },
	});
	assert.deepEqual(fallback, cpu);
	assert.match(fallbackReason, /WebGL2.*unavailable.*CPU fallback.*context lost/iu);

	const invalidGeometry = await processTemporalDenoiseV1({
		current, neighbors, strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				return createGrayVideoFrameV1({ width: 1, height: 1, samples: [0.75] });
			},
		},
	});
	assert.deepEqual(invalidGeometry, cpu);
});

test('motion processing observes cancellation', async () => {
	const controller = new AbortController();
	controller.abort(new Error('cancel motion'));
	await assert.rejects(() => processTemporalDenoiseV1({
		current: translatedDot(0, 0),
		neighbors: [],
		strength: 0.5,
		signal: controller.signal,
	}), /cancel motion|abort/iu);

	const active = new AbortController();
	let fallbackObserved = false;
	await assert.rejects(() => processTemporalDenoiseV1({
		current: translatedDot(0, 0), neighbors: [], strength: 0.5, signal: active.signal,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise(request) {
				active.abort(new Error('cancel accelerated motion'));
				return request.current;
			},
		},
		onAcceleratorFallback() { fallbackObserved = true; },
	}), /cancel accelerated motion/iu);
	assert.equal(fallbackObserved, false);
});
