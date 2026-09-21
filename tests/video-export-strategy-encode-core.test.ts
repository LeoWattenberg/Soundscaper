/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProductVideoExportStrategyEncodeRequest,
} from '../src/common/editor/controller/export/product-video-export-strategy.ts';
import {
	createVideoExportOfflineRequest,
	projectVideoExportBrowserResult,
	projectVideoExportSinkResult,
	type VideoExportEncodeErrorText,
} from '../src/common/editor/video-export-strategy-encode-core.ts';
import type { VideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import type {
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoSinkEncoderResult,
} from '../src/common/editor/video-keyframe-video-encoder.ts';

const ERRORS: VideoExportEncodeErrorText = Object.freeze({
	sourceSet: 'test source set mismatch',
	sourceMissing: (sourceId: string) => `test source ${sourceId} missing`,
	audioMix: 'test audio mix mismatch',
	identity: 'test encoder identity mismatch',
	bytes: 'test browser bytes mismatch',
	chunks: 'test sink chunks mismatch',
});

function plan(withAudio = false): VideoKeyframeExportPlanV7 {
	return {
		activeSourceIds: ['video-a'],
		inputs: withAudio ? [{ kind: 'staged-audio-mix' }] : [],
		canvas: { width: 320, height: 180, frameRate: { num: 30, den: 1 },
			fit: 'contain', backgroundColor: '#000000' },
		range: { startFrame: 2, endFrame: 5 }, format: 'mp4', extension: 'mp4',
		mimeType: 'video/mp4', quality: 'standard',
	} as unknown as VideoKeyframeExportPlanV7;
}

function request(overrides: Record<string, unknown> = {}): ProductVideoExportStrategyEncodeRequest {
	return {
		exportProject: { detached: true }, timingBySourceId: new Map(),
		videoBlobs: new Map([['video-a', new Blob(['frame'])]]), audioMix: null,
		webCodecs: null, editorFfmpeg: { selected: true }, maximumOutputBytes: 128,
		rgbaPostprocessor: undefined, rgbaCompositor: undefined,
		signal: new AbortController().signal, assertCurrent() {}, ...overrides,
	} as unknown as ProductVideoExportStrategyEncodeRequest;
}

function browser(overrides: Record<string, unknown> = {}): VideoKeyframeVideoEncoderResult {
	return {
		format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
		bytes: new Uint8Array([1, 2]), byteLength: 2, videoEncoder: 'ffmpeg', ...overrides,
	} as VideoKeyframeVideoEncoderResult;
}

function sink(overrides: Record<string, unknown> = {}): VideoKeyframeVideoSinkEncoderResult<string> {
	return {
		format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
		output: 'sink', byteLength: 12, outputChunkCount: 3, videoEncoder: 'ffmpeg', ...overrides,
	} as VideoKeyframeVideoSinkEncoderResult<string>;
}

test('the shared export request admits the exact active Blob and preserves caller backend shape', () => {
	const input = request();
	const ffmpeg = createVideoExportOfflineRequest(input, plan(), { editorFfmpeg: input.editorFfmpeg as never }, ERRORS);
	assert.equal(ffmpeg.sources[0]?.blob, input.videoBlobs.get('video-a'));
	assert.deepEqual(ffmpeg.sources.map(({ sourceId }) => sourceId), ['video-a']);
	assert.ok(Object.isFrozen(ffmpeg) && Object.isFrozen(ffmpeg.sources) && Object.isFrozen(ffmpeg.sources[0]));
	assert.deepEqual(ffmpeg.canvas, {
		width: 320, height: 180, frameRate: { num: 30, den: 1 },
		fit: 'contain', backgroundColor: '#000000',
	});
	assert.equal(ffmpeg.maximumOutputBytes, 128);
	assert.equal(Object.hasOwn(ffmpeg, 'webCodecs'), false);
	const webCodecs = Object.freeze({ codec: 'avc1.42E01E', bitrate: 1_000_000 });
	const browserRequest = createVideoExportOfflineRequest(
		input, plan(), { webCodecs }, ERRORS,
	);
	assert.equal(browserRequest.webCodecs, webCodecs);
	assert.equal(Object.hasOwn(browserRequest, 'editorFfmpeg'), false);
});

test('the shared export request rejects Blob and audio mix drift using caller wording', () => {
	assert.throws(() => createVideoExportOfflineRequest(
		request({ videoBlobs: new Map() }), plan(), {}, ERRORS,
	), { name: 'TypeError', message: ERRORS.sourceSet });
	assert.throws(() => createVideoExportOfflineRequest(
		request({ videoBlobs: new Map([['video-a', 'not a Blob']]) }), plan(), {}, ERRORS,
	), { name: 'TypeError', message: 'test source video-a missing' });
	assert.throws(() => createVideoExportOfflineRequest(request(), plan(true), {}, ERRORS),
		{ name: 'TypeError', message: ERRORS.audioMix });
	const audioMix = new Blob(['audio']);
	const admitted = createVideoExportOfflineRequest(request({ audioMix }), plan(true), {}, ERRORS);
	assert.equal(admitted.audioMix, audioMix);
});

test('the shared result projections enforce identity, bytes, and chunks before publication', () => {
	const byteResult = projectVideoExportBrowserResult(browser(), plan(), ERRORS);
	assert.deepEqual(byteResult.bytes, new Uint8Array([1, 2]));
	assert.ok(Object.isFrozen(byteResult));
	assert.equal(Object.hasOwn(byteResult, 'codec'), false);
	assert.throws(() => projectVideoExportBrowserResult(browser({ extension: '.webm' }), plan(), ERRORS),
		{ name: 'Error', message: ERRORS.identity });
	assert.throws(() => projectVideoExportBrowserResult(browser({ byteLength: 3 }), plan(), ERRORS),
		{ name: 'Error', message: ERRORS.bytes });
	const sinkResult = projectVideoExportSinkResult(sink({ codec: 'h264' }), plan(), ERRORS);
	assert.deepEqual({ output: sinkResult.output, count: sinkResult.chunkCount, codec: sinkResult.codec },
		{ output: 'sink', count: 3, codec: 'h264' });
	assert.ok(Object.isFrozen(sinkResult));
	assert.throws(() => projectVideoExportSinkResult(sink({ outputChunkCount: -1 }), plan(), ERRORS),
		{ name: 'RangeError', message: ERRORS.chunks });
	const picturePlan = { format: 'mp4', extension: 'mp4', mimeType: 'video/mp4' } as const;
	assert.equal(projectVideoExportBrowserResult(browser(), picturePlan, ERRORS).byteLength, 2);
	assert.equal(projectVideoExportSinkResult(sink(), picturePlan, ERRORS).chunkCount, 3);
});
