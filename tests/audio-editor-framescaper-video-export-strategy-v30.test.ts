/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../src/common/editor/video-keyframe-video-encoder.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createFramescaperPlaybackProjectServiceV30 } from '../src/framescaper/editor-project-playback-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { createFramescaperVideoExportStrategyV30 } from '../src/framescaper/video-export-strategy-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';
import {
	captureFramescaperExactExportTestFrame,
	composeFramescaperExactExportTestFrame,
} from './helpers/framescaper-exact-export-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('selected V30 browser strategy retains inherited generator export', () => {
	const project = generatorProject();
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	});
	assert.equal(strategy.hasPicture?.(exportProject), true);
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.equal(plan?.version, 13);
	assert.deepEqual(strategy.captureTimingSourceIds?.(plan!), []);
});

test('selected V30 browser strategy renders authenticated timeline image frames', async () => {
	const fixture = createFramescaperV30ImageFixture({ imageOnly: true });
	const rendered: Uint8Array<ArrayBuffer>[] = [];
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE, {
		async encodeOffline() { throw new Error('image-only export must not use the V20 renderer'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			for (const index of [0, 10]) {
				const pixels = new Uint8Array(request.producer.byteLength);
				await request.producer.produce(request.frameSource.frame(index), pixels, {
					signal: request.signal!,
				});
				rendered.push(pixels);
			}
			return encodedResult();
		},
	}, {
		loadMediaAsset: () => Promise.resolve(imageBlob(fixture.bytes)),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project,
		delivery: delivery(fixture.project),
	});
	assert.equal(strategy.hasPicture?.(exportProject), true);
	const plan = strategy.createPlan({
		canonicalProject: fixture.project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	assert.equal(plan.version, 13);
	assert.deepEqual(plan.activeSourceIds, []);
	await strategy.encode({
		canonicalProject: fixture.project,
		exportProject,
		plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
		videoBlobs: new Map(),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	});
	assert.equal(rendered.length, 2);
	assert.equal(hasVisibleChannel(rendered[0]!, 0), true, 'the first packed frame renders red');
	assert.equal(hasVisibleChannel(rendered[1]!, 1), true, 'the second packed frame renders green');
	assert.equal(hasVisibleChannel(rendered[1]!, 2), true, 'the second packed frame retains blue');
});

test('selected V30 image export fails closed on changed frame-pack bytes', async () => {
	const fixture = createFramescaperV30ImageFixture({ imageOnly: true });
	const changed = fixture.bytes.slice();
	changed[changed.length - 1] ^= 1;
	let encodeCalls = 0;
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE, {
		async encodeOffline() { throw new Error('image-only export must not use V20'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture() { encodeCalls += 1; return encodedResult(); },
	}, {
		loadMediaAsset: () => Promise.resolve(imageBlob(changed)),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project,
		delivery: delivery(fixture.project),
	});
	const plan = strategy.createPlan({
		canonicalProject: fixture.project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	await assert.rejects(strategy.encode({
		canonicalProject: fixture.project,
		exportProject,
		plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
		videoBlobs: new Map(),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	}), /complete body digest binding/iu);
	assert.equal(encodeCalls, 0);
});

test('selected V30 keyed export retains an image tail beyond inherited video', async () => {
	const fixture = createFramescaperV30ImageFixture();
	const captured: { request: VideoKeyframeOfflineVideoExportRequest | null } = { request: null };
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			captured.request = request;
			const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4);
			await composeFramescaperExactExportTestFrame(request, {
				index: 10,
				timelineSample: 48_000,
				timelinePosition: { num: 48_000, den: 1 },
				layers: [],
			}, pixels, [0, 0, 0, 0]);
			rendered = pixels;
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	}, {
		loadMediaAsset: () => Promise.resolve(imageBlob(fixture.bytes)),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project,
		delivery: delivery(fixture.project),
	});
	const plan = strategy.createPlan({
		canonicalProject: fixture.project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	assert.equal(plan.version, 7);
	assert.equal(plan.range.endFrame, 720_000);
	await strategy.encode({
		canonicalProject: fixture.project,
		exportProject,
		plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: rawTiming(fixture.project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	});
	assert.ok(captured.request);
	assert.equal(captured.request.endFrame, 720_000);
	assert.ok(rendered);
	assert.equal(hasVisibleChannel(rendered, 1), true);
	assert.equal(hasVisibleChannel(rendered, 2), true);
});

function generatorProject() {
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = [{
		schemaVersion: 1,
		kind: 'generator',
		id: 'solid-clip',
		sourceId: 'solid-source',
		sequenceId: 'main-sequence',
		sequenceStartFrame: 0,
		sequenceFrameCount: 10,
		sourceInFrame: 0,
		sourceFrameCount: 10,
	}];
	(options.projectBin as Record<string, unknown>).clips = [];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['solid-clip'];
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	return createFramescaperProjectV30(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1,
				kind: 'generator',
				id: 'solid-source',
				name: 'Solid',
				width: 2,
				height: 2,
				frameRate: { num: 10, den: 1 },
				frameCount: 10,
				generator: { kind: 'solid', color: '#ff0000ff' },
			}],
		},
	});
}

function delivery(project: ReturnType<typeof createFramescaperProjectV30>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV30(PROFILE)
		.projectForVideoRenderedFallbackDelivery!(project) as ProductVideoExportDelivery;
}

function encodedResult() {
	return Object.freeze({
		bytes: Uint8Array.of(1, 2, 3),
		byteLength: 3,
		videoEncoder: 'ffmpeg' as const,
		format: 'mp4' as const,
		extension: '.mp4' as const,
		mimeType: 'video/mp4' as const,
		frameCount: 10,
		rgbaChunkCount: 1,
		outputChunkCount: 1,
	});
}

function hasVisibleChannel(pixels: Uint8Array, channel: 0 | 1 | 2): boolean {
	for (let offset = channel; offset < pixels.length; offset += 4) {
		if (pixels[offset]! > 32) return true;
	}
	return false;
}

function imageBlob(bytes: Uint8Array): Blob {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return new Blob([owned]);
}

function rawTiming(project: ReturnType<typeof createFramescaperProjectV30>): ReadonlyMap<string, VideoSourceTimingView> {
	const result = new Map<string, VideoSourceTimingView>();
	for (const sourceValue of project.sources) {
		if (sourceValue.kind !== 'video') continue;
		const source = sourceValue as Readonly<{
			readonly id: string;
			readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
			readonly sourceFrameCount: number;
		}>;
		result.set(source.id, Object.freeze({
			kind: 'cfr' as const,
			rate: source.frameRate,
			frameCount: source.sourceFrameCount,
		}));
	}
	return result;
}
