/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegAssistanceVideoMaterializer,
	type AssistanceExternalFfmpegFrameDecodeRequestV1,
} from '../desktop/assistance-external-ffmpeg-video-materializer.ts';
import { externalFfmpegExecutablePairClosureSha256 } from
	'../desktop/external-ffmpeg-node-runtime.ts';
import { reviewAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';

const FFMPEG_SHA = '12'.repeat(32);
const FFPROBE_SHA = '34'.repeat(32);
const PLAN = Object.freeze({ schemaVersion: 1 as const, kind: 'frame-pack-plan' as const,
	sourceId: 'video-source', width: 1_024, height: 512, timescale: 1_000,
	frames: Object.freeze([
		Object.freeze({ resultId: 'visual-sample:0', shotId: 'shot:000000',
			anchor: 'first-third' as const, sourceFrame: 20, presentationTick: '100',
			timelineFrame: 4_800 }),
		Object.freeze({ resultId: 'visual-sample:1', shotId: 'shot:000000',
			anchor: 'second-third' as const, sourceFrame: 40, presentationTick: '200',
			timelineFrame: 9_600 }),
	]),
});

test('the admitted FFmpeg materializer decodes exact ordinals into bounded visual frame packs', async () => {
	const admission = admitted();
	const invalidations: string[] = [];
	const calls: AssistanceExternalFfmpegFrameDecodeRequestV1[] = [];
	const materializer = createExternalFfmpegAssistanceVideoMaterializer({
		preferences: { admission: () => admission,
			async invalidateAdmission(_expected, reason) { invalidations.push(reason); return {} as never; } },
		digestExecutable: async (path) => path.endsWith('ffmpeg') ? FFMPEG_SHA : FFPROBE_SHA,
		decodeFrames: async (request) => {
			calls.push(request);
			return new Uint8Array(request.expectedByteLength).fill(7);
		},
	});
	const chunks = await materializer.materializeFramePack!({ request: {} as AssistanceWorkflowV1,
		plan: PLAN, source: { path: '/private/job/video.input', claim: {} as never },
		signal: new AbortController().signal });
	assert.ok(chunks);
	const reviewed = reviewAssistanceVisualFramePackV2(chunks!);
	assert.deepEqual({ sourceWidth: reviewed.sourceWidth, sourceHeight: reviewed.sourceHeight,
		rasterWidth: reviewed.rasterWidth, rasterHeight: reviewed.rasterHeight,
		frameCount: reviewed.frameCount }, {
		sourceWidth: 1_024, sourceHeight: 512, rasterWidth: 512, rasterHeight: 256,
		frameCount: 2,
	});
	assert.deepEqual(calls[0]?.sourceFrames, [20, 40]);
	assert.deepEqual(reviewed.frame(1), { sourceFrame: 40, presentationTick: '200',
		rgba: new Uint8Array(512 * 256 * 4).fill(7) });
	assert.deepEqual(invalidations, []);
	assert.deepEqual(await materializer.resolveVisualTags!({ request: {} as AssistanceWorkflowV1,
		plan: PLAN, matrix: Uint8Array.of(1), signal: new AbortController().signal }), [
		{ resultId: 'visual-sample:0', tags: [] },
		{ resultId: 'visual-sample:1', tags: [] },
	]);
});

test('the frame materializer typed-refuses absent, underqualified, changed, and oversized authority', async () => {
	const absent = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
		admission: () => null, async invalidateAdmission() { return {} as never; },
	} });
	assert.equal(await absent.materializeFramePack!(frameRequest()), null);

	const admission = admitted();
	const missing = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
		admission: () => ({ ...admission, capabilities: { ...admission.capabilities, filters: [] } }),
		async invalidateAdmission() { return {} as never; },
	} });
	assert.equal(await missing.materializeFramePack!(frameRequest()), null);

	const invalidated: string[] = [];
	const changed = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
		admission: () => admission,
		async invalidateAdmission(_expected, reason) { invalidated.push(reason); return {} as never; },
	}, digestExecutable: async () => 'ff'.repeat(32) });
	assert.equal(await changed.materializeFramePack!(frameRequest()), null);
	assert.deepEqual(invalidated, ['identity-changed']);

	const oversizedPlan = { ...PLAN, width: 4_096, height: 4_096,
		frames: Array.from({ length: 70 }, (_, index) => ({ resultId: `visual-sample:${String(index)}`,
			shotId: 'shot:000000', anchor: 'midpoint' as const, sourceFrame: index,
			presentationTick: String(index), timelineFrame: index })) };
	let decoded = false;
	const bounded = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
		admission: () => admission, async invalidateAdmission() { return {} as never; },
	}, digestExecutable: async (path) => path.endsWith('ffmpeg') ? FFMPEG_SHA : FFPROBE_SHA,
		decodeFrames: async () => { decoded = true; return null; } });
	assert.equal(await bounded.materializeFramePack!({ ...frameRequest(), plan: oversizedPlan }), null);
	assert.equal(decoded, false, 'oversized materialization must not spawn');
});

test('the frame materializer propagates cancellation without publishing partial bytes', async () => {
	const admission = admitted();
	const controller = new AbortController();
	const reason = new DOMException('cancelled', 'AbortError');
	const materializer = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
		admission: () => admission, async invalidateAdmission() { return {} as never; },
	}, digestExecutable: async (path) => path.endsWith('ffmpeg') ? FFMPEG_SHA : FFPROBE_SHA,
		decodeFrames: async (request) => {
			controller.abort(reason);
			request.signal.throwIfAborted();
			return new Uint8Array(request.expectedByteLength);
		} });
	await assert.rejects(async () => await materializer.materializeFramePack!({
		...frameRequest(), signal: controller.signal,
	}), (error) => error === reason);
});

function frameRequest() {
	return { request: {} as AssistanceWorkflowV1, plan: PLAN,
		source: { path: '/private/job/video.input', claim: {} as never },
		signal: new AbortController().signal };
}

function admitted() {
	return Object.freeze({ executablePath: '/tools/ffmpeg', version: '8.0.0',
		capabilityGeneration: '56'.repeat(32), identity: Object.freeze({
			executablePath: '/tools/ffmpeg', ffmpegSha256: FFMPEG_SHA,
			ffprobePath: '/tools/ffprobe', ffprobeSha256: FFPROBE_SHA,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: '/tools/ffmpeg', ffmpegSha256: FFMPEG_SHA,
				ffprobePath: '/tools/ffprobe', ffprobeSha256: FFPROBE_SHA,
			}), version: '8.0.0',
		}), capabilities: Object.freeze({ encoders: Object.freeze([]), decoders: Object.freeze([]),
		muxers: Object.freeze(['rawvideo']), demuxers: Object.freeze([]),
		filters: Object.freeze(['format', 'scale', 'select']) }) });
}
