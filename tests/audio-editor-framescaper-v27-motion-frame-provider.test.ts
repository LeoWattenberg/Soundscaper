/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import {
	createFramescaperMotionAnalysisFrameProviderV27,
} from '../src/framescaper/editor-motion-analysis-frame-provider-v27.ts';

test('selected V27 frame provider authenticates, decodes exact ordinal centers, and reports bounded progress', async () => {
	const original = new Blob(['authenticated-video'], { type: 'video/webm' });
	const digest = await digestMediaContent(original);
	const timestamps: number[] = [];
	const progress: unknown[] = [];
	let disposed = false;
	const provider = createFramescaperMotionAnalysisFrameProviderV27({
		store: { loadMediaAsset: async (key) => {
			assert.equal(key, 'video-storage');
			return original;
		} },
		createExtractor: async (body) => {
			assert.equal(body, original);
			return {
				capture: async (timestamp) => {
					timestamps.push(timestamp);
					return { blob: new Blob([String(timestamp)], { type: 'image/png' }) };
				},
				dispose() { disposed = true; },
			};
		},
		decodeGray: async (_blob, frameNumber) => createGrayVideoFrameV1({
			width: 2, height: 2, samples: [frameNumber / 10, 0, 0, 0],
		}),
	});
	const frames = await provider({
		projectId: 'project-1',
		source: {
			id: 'video-1', storageKey: 'video-storage', contentSha256: digest,
			frameRate: { num: 10, den: 1 }, sourceFrameCount: 10,
		},
		startFrame: 2, endFrame: 4,
		onProgress: (value) => { progress.push(value); },
	});
	assert.deepEqual(timestamps, [0.25, 0.35]);
	assert.deepEqual(frames.map(({ frameNumber }) => frameNumber), [2, 3]);
	assert.deepEqual(progress, [
		{ phase: 'decoding', completed: 1, total: 2 },
		{ phase: 'decoding', completed: 2, total: 2 },
	]);
	assert.equal(disposed, true);
});

test('selected V27 frame provider refuses unauthenticated source bytes before decode', async () => {
	let extracted = false;
	const provider = createFramescaperMotionAnalysisFrameProviderV27({
		store: { loadMediaAsset: async () => new Blob(['changed']) },
		createExtractor: async () => {
			extracted = true;
			throw new Error('must not decode');
		},
		decodeGray: async () => createGrayVideoFrameV1({ width: 1, height: 1, samples: [0] }),
	});
	await assert.rejects(async () => await provider({
		projectId: 'project-1',
		source: {
			id: 'video-1', storageKey: 'video-storage', contentSha256: '00'.repeat(32),
			frameRate: { num: 10, den: 1 }, sourceFrameCount: 10,
		},
		startFrame: 0, endFrame: 2, onProgress() {},
	}), /digest|changed|authenticate/iu);
	assert.equal(extracted, false);
});

test('selected V27 frame provider resolves and authenticates a linked original without using a proxy', async () => {
	const original = new Blob(['linked-original'], { type: 'video/webm' });
	const contentSha256 = await digestMediaContent(original);
	const source = {
		id: 'video-linked', storageKey: 'video-linked', contentSha256,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 4,
	};
	let resolved = 0;
	const provider = createFramescaperMotionAnalysisFrameProviderV27({
		store: {
			loadMediaAsset: async () => null,
			resolveLinkedVideoOriginal: async (projectId, candidate) => {
				assert.equal(projectId, 'project-linked');
				assert.equal(candidate, source);
				resolved += 1;
				return { blob: original, binding: { bindingToken: 'linked-token' } };
			},
		},
		createExtractor: async (body) => {
			assert.equal(body, original);
			return {
				capture: async () => ({ blob: new Blob(['frame']) }),
				dispose() {},
			};
		},
		decodeGray: async () => createGrayVideoFrameV1({ width: 1, height: 1, samples: [0] }),
	});
	const frames = await provider({
		projectId: 'project-linked', source,
		startFrame: 0, endFrame: 2, onProgress() {},
	});
	assert.equal(resolved, 1);
	assert.equal(frames.length, 2);
});

test('selected V27 frame provider seeks verified VFR presentation-cell centers', async () => {
	const original = new Blob(['vfr-video']);
	const contentSha256 = await digestMediaContent(original);
	const timing = createVideoTimingAssetPublication(contentSha256, {
		timescale: 100, presentationTicks: [0n, 10n, 30n, 60n], finalFrameDurationTicks: 40n,
	});
	const timestamps: number[] = [];
	const provider = createFramescaperMotionAnalysisFrameProviderV27({
		store: { loadMediaAsset: async (key) => key === timing.reference.storageKey
			? new Blob([Uint8Array.from(timing.bytes).buffer]) : original },
		createExtractor: async () => ({
			capture: async (timestamp) => {
				timestamps.push(timestamp);
				return { blob: new Blob(['frame']) };
			},
			dispose() {},
		}),
		decodeGray: async () => createGrayVideoFrameV1({ width: 1, height: 1, samples: [0] }),
	});
	await provider({
		projectId: 'project-1',
		source: {
			id: 'video-1', storageKey: 'video-storage', contentSha256,
			frameRate: { num: 10, den: 1 }, sourceFrameCount: 4,
			timingDecision: { mode: 'exact', rate: { num: 10, den: 1 } },
			timingAsset: timing.reference,
		},
		startFrame: 1, endFrame: 3, onProgress() {},
	});
	assert.deepEqual(timestamps, [0.2, 0.45]);
});
