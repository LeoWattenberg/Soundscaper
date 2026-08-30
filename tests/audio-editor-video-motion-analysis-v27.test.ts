/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	analyzeVideoMotionV1,
	requireVideoMotionAnalysisBodyV1,
	videoMotionSettingsSha256V1,
} from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';

const SHA_A = 'a1'.repeat(32);

function translatedSquare(dx: number, dy: number) {
	const width = 24;
	const height = 24;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 7 + dy; y < 15 + dy; y += 1) {
		for (let x = 6 + dx; x < 14 + dx; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

function stack() {
	return {
		schemaVersion: 1 as const,
		id: 'stack-1',
		sourceId: 'video-1',
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
}

test('built-in tracking produces a deterministic digest-bound analysis with progress', async () => {
	const progress: number[] = [];
	const result = await analyzeVideoMotionV1({
		analysisId: 'analysis-1',
		inputSha256: SHA_A,
		processorStack: stack(),
		frames: [
			{ frameNumber: 10, frame: translatedSquare(0, 0) },
			{ frameNumber: 11, frame: translatedSquare(1, 1) },
			{ frameNumber: 12, frame: translatedSquare(2, 2) },
		],
		onProgress(value) { progress.push(value.completed); },
	});
	assert.deepEqual(progress, [1, 2]);
	assert.equal(result.reference.startFrame, 10);
	assert.equal(result.reference.endFrame, 13);
	assert.equal(result.reference.byteLength, result.bytes.byteLength);
	assert.equal(result.reference.settingsSha256, videoMotionSettingsSha256V1(stack()));
	assert.equal(result.body.analysisWidth, 24);
	assert.equal(result.body.analysisHeight, 24);
	assert.equal(result.body.transforms.length, 2);
	for (const row of result.body.transforms) {
		assert.ok(Math.abs(row.transform.translateX - 1) < 0.3);
		assert.ok(Math.abs(row.transform.translateY - 1) < 0.3);
	}

	const admitted = requireVideoMotionAnalysisBodyV1(result.reference, result.bytes, {
		inputSha256: SHA_A,
		processorStack: stack(),
	});
	assert.deepEqual(admitted, result.body);
	assert.equal(Object.isFrozen(admitted.transforms), true);
	assert.throws(() => requireVideoMotionAnalysisBodyV1(
		result.reference,
		result.bytes,
		{
			inputSha256: SHA_A,
			processorStack: {
				...stack(),
				processors: [{ ...stack().processors[0]!, quality: 0.25 }],
			},
		},
	), /stale|settings digest/iu);
	const corrupt = result.bytes.slice();
	corrupt[corrupt.length - 2] ^= 1;
	assert.throws(() => requireVideoMotionAnalysisBodyV1(
		result.reference, corrupt, { inputSha256: SHA_A, processorStack: stack() },
	), /digest|JSON|analysis body/iu);
});

test('motion analysis is cancellable and never admits an optical-flow retime processor', async () => {
	const controller = new AbortController();
	controller.abort(new Error('cancel analysis'));
	await assert.rejects(() => analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SHA_A, processorStack: stack(),
		frames: [
			{ frameNumber: 0, frame: translatedSquare(0, 0) },
			{ frameNumber: 1, frame: translatedSquare(1, 1) },
		],
		signal: controller.signal,
	}), /cancel analysis|abort/iu);
	await assert.rejects(() => analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SHA_A,
		processorStack: {
			...stack(),
			processors: [{
				schemaVersion: 1, id: 'retime-1', kind: 'retime-interpolation',
				enabled: true, motionProvider: 'pyramidal-lucas-kanade',
			}],
		},
		frames: [
			{ frameNumber: 0, frame: translatedSquare(0, 0) },
			{ frameNumber: 1, frame: translatedSquare(1, 1) },
		],
	}), /retime|unsupported|processor/iu);
});

test('motion analysis yields to task-queued cancellation between frame pairs', async () => {
	const controller = new AbortController();
	const progress: number[] = [];
	await assert.rejects(() => analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SHA_A, processorStack: stack(),
		frames: [
			{ frameNumber: 0, frame: translatedSquare(0, 0) },
			{ frameNumber: 1, frame: translatedSquare(1, 1) },
			{ frameNumber: 2, frame: translatedSquare(2, 2) },
		],
		signal: controller.signal,
		onProgress(value) {
			progress.push(value.completed);
			if (value.completed === 1) setTimeout(() => controller.abort(new Error('cancel from UI task')), 0);
		},
	}), /cancel from UI task|abort/iu);
	assert.deepEqual(progress, [1]);
});
