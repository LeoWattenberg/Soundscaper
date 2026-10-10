/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import type { UnifiedExactRenderTimingSidecars } from '../src/common/editor/unified-exact-render-timing-authority.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { acquireVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { bindVideoSourceTimingView, type BoundVideoSourceTimingView, type VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as FINISHING, FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../src/framescaper/editor-project-native-media-foundation.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { applyFramescaperProjectCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedVisualPreviewSessionTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { createTimelineImagePictureCarrier } from '../src/framescaper/timeline-image-picture-carrier.ts';
import { createFramescaperVideoExportImageExecutionTimelineImageV16 } from '../src/framescaper/video-export-image-execution-timeline-image-v16.ts';
import { createFramescaperVideoExportStrategyTimelineImage } from '../src/framescaper/video-export-strategy-timeline-image.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from '../src/framescaper/video-export-visual-freshness-finishing.ts';

const RATE = Object.freeze({ num: 4, den: 1 });
const BLUE = new Uint8Array([0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255]);
const RED = new Uint8Array([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]);
const NEUTRAL_CUBE = Object.freeze({ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } });

function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

function fixture(withImage = false, sourceBody = new TextEncoder().encode('unchanged VFR video original')) {
	const publication = createVideoTimingAssetPublication(sha256(sourceBody), {
		timescale: 100, presentationTicks: [0n, 10n, 30n, 60n], finalFrameDurationTicks: 40n,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const source = createVideoSource({ id: 'video-source', name: 'VFR', storageKey: 'video-source', mimeType: 'video/mp4',
		contentSha256: sha256(sourceBody), frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 4,
		frameRate: RATE, width: 2, height: 2, timingAsset: publication.reference, timingDecision: { mode: 'exact', rate: RATE, backend: 'container' } });
	const view: VideoSourceTimingView = Object.freeze({ kind: 'vfr', reference: publication.reference, index });
	const timingViews = new Map([['video-source', view]]);
	let project = createFramescaperProjectTimelineImage(PROFILE, { id: 'vfr-project', title: 'Verified VFR',
		sources: [source], clips: [{ kind: 'video', id: 'video-clip', sourceId: source.id, title: 'Video', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 4, sourceInFrame: 0, sourceFrameCount: 4, retimeMap: null, videoEffects: [NEUTRAL_CUBE] }],
		projectBin: { clips: [] }, tracks: [createVideoTrack({ id: 'image-track', name: 'Image', clipIds: [], locked: false }),
			createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false })],
		sequences: [{ id: 'main-sequence', rate: RATE, trackIds: ['image-track', 'video-track'] }], primarySequenceId: 'main-sequence',
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
	});
	const pack = createFramescaperImageFramePackV1({ original: new TextEncoder().encode('unchanged image original'),
		receipt: { schemaVersion: 1, decoder: { id: 'browser-native', version: '1' } }, width: 2, height: 2, timingMode: 'embedded',
		frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: RED }] });
	if (withImage) {
		const image = { schemaVersion: 1, kind: 'image', id: 'image-source', name: 'Image', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
			storageKey: 'image-source', contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
			original: { fileName: 'image.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: pack.originalByteLength, sha256: pack.originalSha256 },
			canonical: { width: 2, height: 2, hasAlpha: pack.hasAlpha, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'embedded' },
			conversionReceiptSha256: pack.conversionReceiptSha256 };
		project = applyFramescaperProjectCommandTimelineImage(PROFILE, project, { type: 'batch', commands: [
			{ type: 'image-source/set', sourceId: image.id, expectedSource: null, source: image },
			{ type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
				clip: { schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: image.id, sequenceId: 'main-sequence',
					sequenceStartFrame: 0, sequenceFrameCount: 4, sourceStartTicks: '0' }, placement: { scope: 'timeline', trackId: 'image-track' } },
		] });
	}
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(createTimelineImagePictureCarrier(project));
	const timingSidecars = bindFramescaperUnifiedRenderTimingSidecarsFinishing(foundation, timingViews);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(FINISHING, foundation, {
		sequenceId: 'main-sequence', sampleStart: 0, sampleDuration: 48_000, outputRate: RATE,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width: 2, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' }, quality: 'balanced',
		includeAudio: false, audioLayout: null, timingViews,
		visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(foundation, { startFrame: 0, durationFrames: 48_000 }),
	});
	return { project, foundation, source, sourceBody, publication, index, timingViews, timingSidecars, plan, pack };
}

function options(value: ReturnType<typeof fixture>, timingSidecars: UnifiedExactRenderTimingSidecars | undefined) {
	let loads = 0;
	return { profile: PROFILE, project: value.project, foundationPlan: value.plan, timingSidecars,
		signal: new AbortController().signal, assertCurrent() {},
		store: { async loadMediaAsset(key: string) { loads++; assert.equal(key, 'image-source'); return new Blob([new Uint8Array(value.pack.bytes)]); } },
		get loads() { return loads; } };
}

test('current V16 authenticates verified VFR authority before returning the zero-image result', async () => {
	const value = fixture(), input = options(value, value.timingSidecars);
	assert.equal(await createFramescaperVideoExportImageExecutionTimelineImageV16(input), null);
	assert.equal(input.loads, 0);
	for (const sidecars of [undefined, new Map()]) {
		const refused = options(value, sidecars);
		await assert.rejects(createFramescaperVideoExportImageExecutionTimelineImageV16(refused), /verified timing asset sidecar/u);
		assert.equal(refused.loads, 0);
	}
});

for (const kind of ['missing', 'empty', 'unbound', 'wrong-digest'] as const) test(`current V16 refuses ${kind} VFR authority before image bodies`, async () => {
	const value = fixture(true);
	const other = fixture(false, new TextEncoder().encode('different video original'));
	const unbound = Object.freeze({ sourceId: 'video-source', frameCount: 4, kind: 'vfr' });
	const sidecars = kind === 'missing' ? undefined : kind === 'empty' ? new Map()
		: kind === 'unbound' ? new Map([['video-source', unbound]]) : other.timingSidecars;
	const input = options(value, sidecars);
	await assert.rejects(createFramescaperVideoExportImageExecutionTimelineImageV16(input),
		kind === 'missing' ? /requires verified timing asset sidecars/u : kind === 'empty' ? /has no verified timing asset sidecar/u
			: kind === 'unbound' ? /not produced by bindVideoSourceTimingView/u : /disagrees with its plan source identity/u);
	assert.equal(input.loads, 0);
});

test('current V16 snapshots native Map entries without invoking borrowed methods and retains token brands', async () => {
	const value = fixture();
	class Sidecars extends Map<string, BoundVideoSourceTimingView> {
		override entries(): never { throw Error('Borrowed entries must not run.'); }
		override [Symbol.iterator](): never { throw Error('Borrowed iterator must not run.'); }
		override forEach(): never { throw Error('Borrowed forEach must not run.'); }
	}
	const sidecars = new Sidecars(value.timingSidecars), input = options(value, sidecars);
	Object.defineProperty(input, 'foundationPlan', { get() { sidecars.clear(); return value.plan; } });
	assert.equal(await createFramescaperVideoExportImageExecutionTimelineImageV16(input), null);
	assert.equal(sidecars.size, 0); assert.equal(input.loads, 0);
});

test('current V16 retains the exact branded token through a native Map snapshot before a held image body', async () => {
	const value = fixture(true), sidecars = new Map(value.timingSidecars), input = options(value, sidecars);
	let entered!: () => void, release!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const held = new Promise<void>(resolve => { release = resolve; });
	input.store.loadMediaAsset = async key => { assert.equal(key, 'image-source'); entered(); await held; return new Blob([new Uint8Array(value.pack.bytes)]); };
	const task = createFramescaperVideoExportImageExecutionTimelineImageV16(input);
	const raced = await Promise.race([started.then(() => 'body'), task.then(() => 'settled', () => 'rejected')]);
	assert.equal(raced, 'body');
	const token = sidecars.get('video-source'); assert.ok(token);
	assert.equal(token, value.timingSidecars.get('video-source'));
	sidecars.set('video-source', bindVideoSourceTimingView(fixture().timingViews, value.source));
	sidecars.clear(); release();
	const execution = await task; assert.ok(execution);
	try {
		const frame = createVideoExactPictureExportFrameSource({ sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
			canvas: { width: 2, height: 2, frameRate: RATE, fit: 'contain', backgroundColor: '#00000000' } }).frame(0);
		const pictures = await execution.resolve({ frame, sequencePosition: { num: 0, den: 1 }, width: 2, height: 2, signal: input.signal });
		assert.equal(pictures.length, 1); assert.deepEqual(pictures[0]?.frame.pixels, RED);
		assert.equal(sha256(value.sourceBody), value.publication.reference.sourceSha256);
	} finally { await execution.dispose(); }
});

function canvas(t: TestContext) {
	const old = ['document', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const), writes: number[][] = [];
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return { width: 2, height: 2, getContext() {
		return { clearRect() {}, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(BLUE) }; },
			putImageData(image: { data: Uint8ClampedArray }) { writes.push(Array.from(image.data)); } };
	} }; } } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	t.after(() => { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
	return writes;
}

test('selected current TimelineImage VFR preview passes verified authority through the zero-image supplemental route', async t => {
	const value = fixture(), writes = canvas(t), lease = acquireVideoTimingIndex(value.source, value.index);
	t.after(() => { lease.release(); });
	const store = new AudioEditorProjectStore(); let loads = 0;
	store.loadMediaAsset = async () => { loads++; throw Error('No image or enabled LUT needs a body.'); };
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: value.project, width: 2, height: 2, store });
	assert.ok(session); assert.ok(session.renderExact); assert.ok(session.close);
	try {
		await session.renderExact({ timelineSample: 0, signal: new AbortController().signal, mediaLayers: [{ trackId: 'video-track', entries: [{
			clipId: 'video-clip', sourceId: 'video-source', effects: [NEUTRAL_CUBE], intervalProgress: 0, displayWidth: 2, displayHeight: 2,
			video: { drawable: {}, videoWidth: 2, videoHeight: 2, readyState: 4 },
			renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
				sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 },
		}] }] });
		assert.deepEqual(writes.at(-1), Array.from(BLUE)); assert.equal(loads, 0);
	} finally { await session.close(); }
});

test('selected current TimelineImage VFR export carries verified authority into image execution and the exact compositor', async () => {
	const value = fixture(true); let encoded = 0;
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE, {
		captureExactFrame() { return { width: 2, height: 2, pixels: new Uint8Array(BLUE) }; },
		async encodeOffline(request) {
			encoded++; assert.ok(request.rgbaCompositor);
			const frames = createVideoExactPictureExportFrameSource({ sampleRate: 48_000, startFrame: 0, endFrame: 48_000, canvas: request.canvas });
			const target = new Uint8Array(16);
			await request.rgbaCompositor({ frame: frames.frame(0), layers: [{ trackId: 'video-track', entries: [{ clipId: 'video-clip',
				sourceId: 'video-source', effects: [], presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
				intervalProgress: 0, displayWidth: 2, displayHeight: 2, video: { drawable: {} },
				renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
					sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 },
			}] }], width: 2, height: 2, rgba: target, signal: request.signal });
			assert.deepEqual(target, RED);
			// This protocol stub qualifies the real exact compositor above, not encoded AV delivery.
			return { bytes: new Uint8Array([1]), byteLength: 1, videoEncoder: 'ffmpeg', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
				frameCount: 1, rgbaChunkCount: 1, outputChunkCount: 1 };
		}, async encodeOfflineToSink() { throw Error('This regression has no sink.'); },
	}, { async loadMediaAsset(key: string) { assert.equal(key, 'image-source'); return new Blob([new Uint8Array(value.pack.bytes)]); } });
	const canonicalProject = value.project;
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: {}, audioRenderedFallback: null,
		videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
		canvas: { width: 2, height: 2, frameRate: RATE, fit: 'contain', backgroundColor: '#00000000' } }); assert.ok(plan);
	const output = await strategy.encode({ canonicalProject, exportProject, plan, timingBySourceId: value.timingSidecars,
		timingViewsBySourceId: value.timingViews, videoBlobs: new Map([['video-source', new Blob([value.sourceBody])]]),
		audioMix: null, editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal, maximumOutputBytes: 1024, assertCurrent() {} });
	assert.equal(encoded, 1); assert.equal(output.byteLength, 1); assert.equal(sha256(value.sourceBody), value.source.contentSha256);
});
