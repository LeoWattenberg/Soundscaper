/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../src/common/editor/video-keyframe-video-encoder.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createFramescaperPlaybackProjectServiceV32 } from '../src/framescaper/editor-project-playback-v32.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	createFramescaperProjectV32,
} from '../src/framescaper/editor-project-v32.ts';
import { createFramescaperVideoExportStrategyV32 } from '../src/framescaper/video-export-strategy-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { createFramescaperV32ImageFixture } from './helpers/framescaper-v32-image-fixture.ts';
import {
	captureFramescaperExactExportTestFrame,
	composeFramescaperExactExportTestFrame,
} from './helpers/framescaper-exact-export-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

test('selected V32 browser strategy retains inherited generator export', () => {
	const project = generatorProject();
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE);
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

test('selected V32 browser strategy renders authenticated timeline image frames', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const rendered: Uint8Array<ArrayBuffer>[] = [];
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
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

test('selected V32 image export honors the delivery canvas fit', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
		async encodeOffline() { throw new Error('image-only export must not use V20'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			const pixels = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), pixels, { signal: request.signal! });
			rendered = pixels;
			return encodedResult();
		},
	}, {
		loadMediaAsset: () => Promise.resolve(imageBlob(fixture.bytes)),
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project, delivery: delivery(fixture.project),
	});
	const plan = strategy.createPlan({
		canonicalProject: fixture.project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { size: { width: 2, height: 4 }, fit: 'stretch' },
	});
	assert.ok(plan);
	await strategy.encode(imageOnlyEncodeRequest(fixture.project, exportProject, plan));
	assert.ok(rendered);
	assert.deepEqual([...rendered], [
		255, 0, 0, 255, 0, 0, 0, 255,
		255, 0, 0, 255, 0, 0, 0, 255,
		255, 0, 0, 255, 0, 0, 0, 255,
		255, 0, 0, 255, 0, 0, 0, 255,
	]);
});

test('selected V32 image export fails closed on changed frame-pack bytes', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const changed = fixture.bytes.slice();
	changed[changed.length - 1] ^= 1;
	let encodeCalls = 0;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
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

test('selected V32 keyed export retains an image tail beyond inherited video', async () => {
	const fixture = createFramescaperV32ImageFixture();
	const captured: { request: VideoKeyframeOfflineVideoExportRequest | null } = { request: null };
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
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

test('selected V32 keyed export composites image alpha in authored track order', async () => {
	const fixture = createFramescaperV32ImageFixture({
		firstFrameRgba: [255, 0, 0, 128, 0, 0, 0, 0],
	});
	const results = new Map<'above' | 'below', readonly number[]>();
	for (const placement of ['above', 'below'] as const) {
		const project = overlappingImageProject(fixture.project, placement);
		const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
			captureExactFrame: captureFramescaperExactExportTestFrame,
			async encodeOffline(request) {
				const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4);
				await composeFramescaperExactExportTestFrame(request, {
					index: 0,
					timelineSample: 0,
					timelinePosition: { num: 0, den: 1 },
					layers: [{ trackId: 'video-track', clips: [{
						clipId: 'video-clip', sourceId: 'video-source',
						presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
					}] }],
				}, pixels, [0, 0, 255, 255]);
				results.set(placement, [...pixels.subarray(0, 4)]);
				return encodedResult();
			},
			async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		}, {
			loadMediaAsset: () => Promise.resolve(imageBlob(fixture.bytes)),
		});
		const exportProject = strategy.createExportProject({
			canonicalProject: project, delivery: delivery(project),
		});
		const plan = strategy.createPlan({
			canonicalProject: project, exportProject, format: 'mp4', range: 'project',
			includeAudio: false, canvas: { size: { width: 2, height: 2 }, fit: 'stretch' },
		});
		assert.ok(plan);
		await strategy.encode({
			...imageOnlyEncodeRequest(project, exportProject, plan),
			timingViewsBySourceId: rawTiming(project),
			videoBlobs: new Map([['video-source', new Blob(['video'])]]),
		});
	}
	assert.deepEqual(results.get('above'), [180, 0, 180, 255]);
	assert.deepEqual(results.get('below'), [0, 0, 255, 255]);
});

test('selected V32 image export keeps same-revision project authorities isolated', async () => {
	const first = createFramescaperV32ImageFixture({ imageOnly: true, originalText: 'first image body' });
	const second = createFramescaperV32ImageFixture({ imageOnly: true, originalText: 'second image body' });
	let rendered: Uint8Array<ArrayBuffer> | null = null;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
		async encodeOffline() { throw new Error('image-only export must not use V20'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture(_editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			const pixels = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), pixels, { signal: request.signal! });
			rendered = pixels;
			return encodedResult();
		},
	}, {
		loadMediaAsset: () => Promise.resolve(imageBlob(first.bytes)),
	});
	const firstExport = strategy.createExportProject({
		canonicalProject: first.project, delivery: delivery(first.project),
	});
	const firstPlan = strategy.createPlan({
		canonicalProject: first.project, exportProject: firstExport,
		format: 'mp4', range: 'project', includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(firstPlan);
	strategy.createExportProject({
		canonicalProject: second.project, delivery: delivery(second.project),
	});
	await strategy.encode(imageOnlyEncodeRequest(first.project, firstExport, firstPlan));
	assert.ok(rendered);
	assert.equal(hasVisibleChannel(rendered, 0), true);
});

test('selected V32 image export detects in-place image authority changes', () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project, delivery: delivery(fixture.project),
	});
	const source = fixture.project.sources.find(({ kind }) => kind === 'image');
	assert.ok(source);
	(source as unknown as Record<string, unknown>).contentSha256 = 'ab'.repeat(32);
	assert.throws(() => strategy.createPlan({
		canonicalProject: fixture.project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	}), /stale/iu);
});

test('selected V32 image export retains valid null-prototype project authority', () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const project = Object.assign(Object.create(null), fixture.project) as typeof fixture.project;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	assert.doesNotThrow(() => strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	}));
});

test('selected V32 export does not open image bodies outside the exact range', async () => {
	const fixture = createFramescaperV32ImageFixture();
	const moved = structuredClone(fixture.project);
	const imageClip = moved.clips.find(({ kind }) => kind === 'image');
	assert.ok(imageClip);
	(imageClip as unknown as Record<string, unknown>).sequenceStartFrame = 10;
	const project = cloneFramescaperProjectV32(PROFILE, moved);
	let encodeCalls = 0;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
		captureExactFrame: captureFramescaperExactExportTestFrame,
		async encodeOffline(request) {
			encodeCalls += 1;
			const pixels = new Uint8Array(request.canvas.width * request.canvas.height * 4);
			await composeFramescaperExactExportTestFrame(request, {
				index: 0,
				timelineSample: 0,
				timelinePosition: { num: 0, den: 1 },
				layers: [{ clips: [{
					clipId: 'video-clip', sourceId: 'video-source',
					presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
				}] }],
			}, pixels, [0, 0, 0, 255]);
			return encodedResult();
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: { startFrame: 0, endFrame: 48_000 },
		includeAudio: false,
		canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	await strategy.encode({
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: rawTiming(project),
		videoBlobs: new Map([['video-source', new Blob(['video'])]]),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	});
	assert.equal(encodeCalls, 1);
});

test('selected V32 export admits aggregate active image assets before reading storage', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const expanded = structuredClone(fixture.project);
	const source = expanded.sources.find(({ kind }) => kind === 'image');
	const clip = expanded.clips.find(({ kind }) => kind === 'image');
	const track = expanded.tracks.find(({ type }) => type === 'video');
	assert.ok(source && clip && track);
	(source as unknown as Record<string, unknown>).assetByteLength = 300 * 1024 * 1024;
	const secondSource = structuredClone(source) as unknown as Record<string, unknown>;
	secondSource.id = 'image-source-2';
	secondSource.storageKey = 'image-source-2';
	const secondClip = structuredClone(clip) as unknown as Record<string, unknown>;
	secondClip.id = 'image-clip-2';
	secondClip.sourceId = 'image-source-2';
	(expanded.sources as unknown as Record<string, unknown>[]).push(secondSource);
	(expanded.clips as unknown as Record<string, unknown>[]).push(secondClip);
	(track.clipIds as string[]).push('image-clip-2');
	const project = cloneFramescaperProjectV32(PROFILE, expanded);
	let reads = 0;
	const strategy = createFramescaperVideoExportStrategyV32(PROFILE, {
		async encodeOffline() { throw new Error('image-only export must not use V20'); },
		async encodeOfflineToSink() { throw new Error('sink path is not used'); },
		async encodePicture() { throw new Error('aggregate admission must precede encoding'); },
	}, {
		loadMediaAsset() { reads += 1; return Promise.resolve(imageBlob(fixture.bytes)); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project, delivery: delivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	await assert.rejects(
		strategy.encode(imageOnlyEncodeRequest(project, exportProject, plan)),
		/active image assets exceed their byte bound/iu,
	);
	assert.equal(reads, 0);
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
	return createFramescaperProjectV32(PROFILE, {
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

function overlappingImageProject(
	projectValue: ReturnType<typeof createFramescaperProjectV32>,
	placement: 'above' | 'below',
) {
	const project = structuredClone(projectValue);
	const videoTrack = project.tracks.find(({ id }) => id === 'video-track');
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!videoTrack || !sequence) throw new Error('The overlap fixture lost its primary video lane.');
	(videoTrack as unknown as Record<string, unknown>).clipIds = videoTrack.clipIds
		.filter((id) => id !== 'image-clip-1');
	const imageTrack = structuredClone(videoTrack) as unknown as Record<string, unknown>;
	imageTrack.id = 'image-track';
	imageTrack.name = 'Images';
	imageTrack.clipIds = ['image-clip-1'];
	const tracks = project.tracks as unknown as Record<string, unknown>[];
	const projectVideoIndex = tracks.findIndex(({ id }) => id === 'video-track');
	tracks.splice(placement === 'above' ? projectVideoIndex : projectVideoIndex + 1, 0, imageTrack);
	const trackIds = sequence.trackIds.filter((id) => id !== 'image-track');
	const videoIndex = trackIds.indexOf('video-track');
	const insertionIndex = placement === 'above' ? videoIndex : videoIndex + 1;
	trackIds.splice(insertionIndex, 0, 'image-track');
	(sequence as unknown as Record<string, unknown>).trackIds = trackIds;
	const trackNodes = structuredClone(
		(sequence as unknown as Record<string, unknown>).trackNodes,
	) as Record<string, unknown>[];
	trackNodes.splice(insertionIndex, 0, {
		kind: 'track', id: 'image-track', parentFolderId: null,
	});
	(sequence as unknown as Record<string, unknown>).trackNodes = trackNodes;
	return cloneFramescaperProjectV32(PROFILE, project);
}

function delivery(project: ReturnType<typeof createFramescaperProjectV32>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV32(PROFILE)
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

function imageOnlyEncodeRequest(
	project: ReturnType<typeof createFramescaperProjectV32>,
	exportProject: Readonly<Record<string, unknown>>,
	plan: NonNullable<ReturnType<ReturnType<typeof createFramescaperVideoExportStrategyV32>['createPlan']>>,
) {
	return {
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map<string, never>(),
		timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
		videoBlobs: new Map<string, Blob>(),
		audioMix: null,
		editorFfmpeg: {},
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	};
}

function rawTiming(project: ReturnType<typeof createFramescaperProjectV32>): ReadonlyMap<string, VideoSourceTimingView> {
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
