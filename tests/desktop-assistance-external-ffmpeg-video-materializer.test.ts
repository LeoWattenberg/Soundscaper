/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createExternalFfmpegAssistanceVideoMaterializer,
	type AssistanceExternalFfmpegFrameDecodeRequestV1,
} from '../desktop/assistance-external-ffmpeg-video-materializer.ts';
import { externalFfmpegExecutablePairClosureSha256 } from
	'../desktop/external-ffmpeg-node-runtime.ts';
import {
	createAssistanceEmbeddingMatrixV1,
	reviewAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import { reviewAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1 } from
	'../src/common/editor/assistance/visual-search-records-v1.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';

const FFMPEG_SHA = '12'.repeat(32);
const FFPROBE_SHA = '34'.repeat(32);
const SOURCE = Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112);
let sourceDirectory = '';
let sourcePath = '';
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

test.before(async () => {
	sourceDirectory = await mkdtemp(join(tmpdir(), 'assistance-video-materializer-source-'));
	sourcePath = join(sourceDirectory, 'video.input');
	await writeFile(sourcePath, SOURCE);
});

test.after(async () => await rm(sourceDirectory, { recursive: true, force: true }));

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
	const packs = await materializer.materializeFramePack!(frameRequest());
	assert.ok(packs);
	assert.equal(packs!.length, 1);
	const reviewed = reviewAssistanceVisualFramePackV2(packs![0]!);
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
	const tagged = await materializer.resolveVisualTags!({ request: {} as AssistanceWorkflowV1,
		plan: PLAN, matrix: visualTagMatrix(), signal: new AbortController().signal });
	assert.ok(tagged);
	assert.equal(reviewAssistanceEmbeddingMatrixV1(tagged!.matrix).rowCount, 2);
	assert.deepEqual(tagged!.tags.map(({ resultId, tags }) => ({ resultId,
		tags: tags.map(({ tag }) => tag) })), [
		{ resultId: 'visual-sample:0', tags: ['person'] },
		{ resultId: 'visual-sample:1', tags: ['outdoor'] },
	]);
});

test('the admitted FFmpeg materializer emits ordered strict packs beyond 341 long shots', async () => {
	const admission = admitted();
	const calls: AssistanceExternalFfmpegFrameDecodeRequestV1[] = [];
	const frames = Array.from({ length: 342 * 3 }, (_, index) => Object.freeze({
		resultId: `visual-sample:${String(index)}`, shotId: `shot:${String(Math.floor(index / 3))}`,
		anchor: ['first-quarter', 'midpoint', 'third-quarter'][index % 3] as
			'first-quarter' | 'midpoint' | 'third-quarter',
		sourceFrame: index * 10, presentationTick: String(index * 100 + 1),
		timelineFrame: index * 1_000,
	}));
	const materializer = createExternalFfmpegAssistanceVideoMaterializer({
		preferences: { admission: () => admission,
			async invalidateAdmission() { return {} as never; } },
		digestExecutable: async (path) => path.endsWith('ffmpeg') ? FFMPEG_SHA : FFPROBE_SHA,
		decodeFrames: async (request) => {
			calls.push(request);
			return new Uint8Array(request.expectedByteLength);
		},
	});
	const packs = await materializer.materializeFramePack!({ ...frameRequest(),
		plan: { ...PLAN, width: 1, height: 1, frames } });
	assert.ok(packs);
	assert.deepEqual(packs!.map((pack) => reviewAssistanceVisualFramePackV2(pack).frameCount),
		[1_024, 2]);
	assert.deepEqual(calls.map(({ sourceFrames }) => sourceFrames.length), [1_024, 2]);
	assert.equal(reviewAssistanceVisualFramePackV2(packs![1]!).frame(0).sourceFrame, 10_240);
});

function visualTagMatrix(): Uint8Array {
	const dimensions = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.length;
	const person = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.indexOf('person');
	const outdoor = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.indexOf('outdoor');
	return createAssistanceEmbeddingMatrixV1({ dimensions, vectors: [
		basis(dimensions, person), basis(dimensions, outdoor),
		...Array.from({ length: dimensions }, (_, index) => basis(dimensions, index)),
	] });
}

function basis(dimensions: number, index: number): Float32Array {
	const result = new Float32Array(dimensions);
	result[index] = 1;
	return result;
}

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
		frames: Array.from({ length: 4_033 }, (_, index) => ({ resultId: `visual-sample:${String(index)}`,
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

test('the frame materializer rejects decoded bytes when its authenticated source changes', async () => {
	await withDirectory(async (directory) => {
		const sourcePath = join(directory, 'video.input');
		const source = Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112);
		await writeFile(sourcePath, source);
		const admission = admitted();
		const materializer = createExternalFfmpegAssistanceVideoMaterializer({ preferences: {
			admission: () => admission, async invalidateAdmission() { return {} as never; },
		}, digestExecutable: async (path) => path.endsWith('ffmpeg') ? FFMPEG_SHA : FFPROBE_SHA,
			decodeFrames: async (request) => {
				await writeFile(request.sourcePath, Uint8Array.from(source, (value) => value ^ 0xff));
				return new Uint8Array(request.expectedByteLength);
			} });
		assert.equal(await materializer.materializeFramePack!({ ...frameRequest(), source: {
			path: sourcePath, claim: { byteLength: source.byteLength,
				sha256: createHash('sha256').update(source).digest('hex') } as never,
		} }), null);
	});
});

function frameRequest() {
	return { request: {} as AssistanceWorkflowV1, plan: PLAN,
		source: { path: sourcePath, claim: { byteLength: SOURCE.byteLength,
			sha256: createHash('sha256').update(SOURCE).digest('hex') } as never },
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

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'assistance-video-materializer-test-'));
	try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
