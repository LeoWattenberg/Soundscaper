/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { shouldRenderExactProductVideoPreview } from '../src/common/editor/ui/workspace/video-preview-exact-render-policy.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { applyFramescaperProjectCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperSelectedVisualPreviewSessionTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperVideoExportStrategyTimelineImage } from '../src/framescaper/video-export-strategy-timeline-image.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createFramescaperVideoExportImageExecutionTimelineImageV16 } from '../src/framescaper/video-export-image-execution-timeline-image-v16.ts';
import { createTimelineImagePictureCarrier } from '../src/framescaper/timeline-image-picture-carrier.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../src/framescaper/editor-project-native-media-foundation.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from '../src/framescaper/video-export-visual-freshness-finishing.ts';

const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const lut = parseCubeLutV1(text), lutBytes = new TextEncoder().encode(text);
const ref = { storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256, byteLength: lut.byteLength,
	size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax };
const effect = { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } };
const original = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
// Red alpha128 overlays cube-blue in linear light. The owning output conversion
// encodes 128/255 as188 and127/255 as187; other transparent/opaque cells remain exact.
const expected = [188,0,187,255,0,255,0,255,255,255,255,255,255,255,255,255];

function fixture(legacyGrade = false, effects: readonly unknown[] = legacyGrade ? [] : [effect]) {
	const pack = createFramescaperImageFramePackV1({ original: new TextEncoder().encode('immutable image original'),
		receipt: { schemaVersion: 1, decoder: { id: 'browser-native', version: '1' } }, width: 2, height: 2, timingMode: 'embedded',
		frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n,
			rgba: new Uint8Array([255,0,0,128,0,0,0,0,255,255,255,255,0,0,0,0]) }] });
	const source = { schemaVersion: 1, kind: 'image', id: 'image-source', name: 'Image', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source', contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
		original: { fileName: 'image.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: pack.originalByteLength, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 2, hasAlpha: pack.hasAlpha, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'embedded' },
		conversionReceiptSha256: pack.conversionReceiptSha256 };
	const raw = framescaperV20Options(), rate = { num: 1, den: 1 };
	const project = createFramescaperProjectTimelineImage(PROFILE, { ...raw,
		sources: (raw.sources as readonly Readonly<Record<string, unknown>>[]).filter(row => row.kind === 'video').map(row => ({ ...row,
			width: 2, height: 2, frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 1, frameRate: rate,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate } })),
		clips: (raw.clips as readonly Readonly<Record<string, unknown>>[]).filter(row => row.kind === 'video').map(row => ({ ...row,
			sequenceFrameCount: 1, sourceFrameCount: 1, videoEffects: effects })), projectBin: { clips: [] },
		tracks: [createVideoTrack({ id: 'image-track', name: 'Image', clipIds: [], locked: false }),
			createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false })],
		sequences: [{ id: 'main-sequence', rate, trackIds: ['image-track', 'video-track'] }], primarySequenceId: 'main-sequence',
		finishing: { ...(legacyGrade ? { visualPresentations: [{ schemaVersion: 1, id: 'grade', owner: { kind: 'clip', id: 'video-clip' }, enabled: true, opacity: 1, blendMode: 'normal', processorStackId: null, maskMatteIds: [],
			grade: { schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: .18, lift: [0,0,0], gamma: [1,1,1], gain: [1,1,1], saturation: 1, lut: ref } }] } : {}), colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
	});
	return { pack, project: applyFramescaperProjectCommandTimelineImage(PROFILE, project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
			clip: { schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: source.id, sequenceId: 'main-sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 1, sourceStartTicks: '0' }, placement: { scope: 'timeline', trackId: 'image-track' } },
	] }) };
}

function dom(t: TestContext) {
	const descriptors = ['document', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	const writes: number[][] = [];
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		return { width: 2, height: 2, getContext() { return { clearRect() {}, drawImage() {},
			getImageData() { return { data: new Uint8ClampedArray(original) }; },
			putImageData(image: { data: Uint8ClampedArray }) { writes.push(Array.from(image.data)); } }; } };
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	t.after(() => { for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	return writes;
}

function renderRequest(signal: AbortSignal, legacyGrade = false, effects: readonly unknown[] = legacyGrade ? [] : [effect]) {
	return { timelineSample: 0, signal, mediaLayers: [{ trackId: 'video-track', entries: [{ clipId: 'video-clip', sourceId: 'video-source', effects, intervalProgress: 0,
		displayWidth: 2, displayHeight: 2, video: { drawable: {}, videoWidth: 2, videoHeight: 2, readyState: 4 },
		renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
			sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 } }] }] };
}

for (const legacyGrade of [false, true]) test(`current timelineImage playing composes ${legacyGrade ? 'old GradeV27 LUT' : 'cube'} video with a translucent image in authored track order`, async t => {
	const writes = dom(t);
	const value = fixture(legacyGrade);
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: value.project,
		width: 2, height: 2, signal: new AbortController().signal, store: { async loadMediaAsset(key: string) {
			if (key === 'image-source') return new Blob([new Uint8Array(value.pack.bytes)]);
			assert.equal(key, ref.storageKey); return new Blob([lutBytes]);
		} } as never });
	assert.ok(session);
	try {
		assert.equal(shouldRenderExactProductVideoPreview(session, 'playing'), true); assert.equal(typeof session.renderExact, 'function');
		await session.renderExact!(renderRequest(new AbortController().signal, legacyGrade));
		assert.deepEqual(writes.at(-1), expected);
	} finally { if (session.close) await session.close(); else session.dispose(); }
});

function deferred() {
	let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

function imagePlan(value: ReturnType<typeof fixture>) {
	const rate = { num: 1, den: 1 };
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(createTimelineImagePictureCarrier(value.project));
	return createFramescaperProjectUnifiedExactRenderPlanV16(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		foundation, {
			sequenceId: 'main-sequence', sampleStart: 0, sampleDuration: 48_000, outputRate: rate,
			format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
			codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
			canvas: { width: 2, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' }, quality: 'balanced',
			includeAudio: false, audioLayout: null, timingViews: new Map([['video-source', { kind: 'cfr', rate, frameCount: 1 }]]),
			visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(foundation, { startFrame: 0, durationFrames: 48_000 }),
		});
}

for (const phase of ['cold', 'currentness'] as const) test(`currentV16 image execution refuses ${phase} opaque native abort before any body admission`, async () => {
	const value = fixture(), stop = new AbortController(); let loads = 0, checks = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	Object.defineProperty(stop.signal, 'aborted', { configurable: true, value: false });
	Object.defineProperty(stop.signal, 'reason', { configurable: true, value: 'caller shadow' });
	if (phase === 'cold') stop.abort(reason);
	const outcome = await createFramescaperVideoExportImageExecutionTimelineImageV16({ profile: PROFILE, project: value.project,
		foundationPlan: imagePlan(value), signal: stop.signal, assertCurrent() { checks++; stop.abort(reason); },
		store: { async loadMediaAsset() { loads++; return new Blob([new Uint8Array(value.pack.bytes)]); } },
	}).then(async execution => { await execution?.dispose(); return { rejected: false, error: undefined }; }, error => ({ rejected: true, error: error as unknown }));
	assert.equal(outcome.rejected, true); assert.equal(outcome.error, reason); assert.equal(loads, 0);
	assert.equal(checks, phase === 'cold' ? 0 : 1); assert.equal(traps, 0);
});

test('currentV16 option capture preserves the first native opaque abort over a later getter failure', async () => {
	const value = fixture(), stop = new AbortController(); let traps = 0, loads = 0;
	const first = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	const later = Object.freeze({ later: 'currentness getter refused' });
	const options = { profile: PROFILE, project: value.project, foundationPlan: imagePlan(value), signal: stop.signal,
		assertCurrent() {}, store: { async loadMediaAsset() { loads++; return new Blob([new Uint8Array(value.pack.bytes)]); } } };
	Object.defineProperty(options, 'assertCurrent', { get() { stop.abort(first); throw later; } });
	const result = await createFramescaperVideoExportImageExecutionTimelineImageV16(options)
		.then(() => ({ rejected: false, error: undefined }), error => ({ rejected: true, error: error as unknown }));
	assert.equal(result.rejected, true); assert.equal(result.error, first); assert.equal(loads, 0); assert.equal(traps, 0);
});

test('currentV16 image creation captures original currentness options across a held body', async () => {
	const value = fixture(), stop = new AbortController(), entered = deferred(), held = deferred(); let checks = 0, replacements = 0, settled = false;
	const options = { profile: PROFILE, project: value.project, foundationPlan: imagePlan(value), signal: stop.signal,
		assertCurrent() { assert.equal(this, options); checks++; }, store: { async loadMediaAsset() { entered.release(); await held.promise; return new Blob([new Uint8Array(value.pack.bytes)]); } } };
	const task = createFramescaperVideoExportImageExecutionTimelineImageV16(options).then(async execution => { await execution?.dispose(); return { rejected: false, error: undefined }; }, error => ({ rejected: true, error: error as unknown })).then(result => { settled = true; return result; });
	await entered.promise; options.signal = new AbortController().signal; options.assertCurrent = function () { replacements++; };
	await Promise.resolve(); assert.equal(settled, false); held.release();
	const result = await task; assert.equal(result.rejected, false); assert.ok(checks > 1); assert.equal(replacements, 0);
});

test('currentV16 image resolve refuses opaque native abort from the final currentness callback before publishing planes', async () => {
	const value = fixture(), stop = new AbortController(); let armed = false, checks = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	Object.defineProperty(stop.signal, 'aborted', { value: false }); Object.defineProperty(stop.signal, 'reason', { value: 'shadow' });
	const execution = await createFramescaperVideoExportImageExecutionTimelineImageV16({ profile: PROFILE, project: value.project,
		foundationPlan: imagePlan(value), signal: new AbortController().signal, assertCurrent() { if (armed && ++checks === 2) stop.abort(reason); },
		store: { async loadMediaAsset() { return new Blob([new Uint8Array(value.pack.bytes)]); } } }); assert.ok(execution);
	armed = true;
	const frame = createVideoExactPictureExportFrameSource({ sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
		canvas: { width: 2, height: 2, frameRate: { num: 1, den: 1 }, fit: 'contain', backgroundColor: '#00000000' } }).frame(0);
	try {
		const result = await Promise.resolve(execution.resolve({ frame, sequencePosition: { num: 0, den: 1 }, width: 2, height: 2, signal: stop.signal }))
			.then(() => ({ rejected: false, error: undefined }), error => ({ rejected: true, error: error as unknown }));
		assert.equal(result.rejected, true); assert.equal(result.error, reason); assert.equal(checks, 2); assert.equal(traps, 0);
	} finally { await execution.dispose(); }
});

test('currentV16 cached image resolve retains its original request signal across the processing await', async () => {
	const value = fixture(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	const execution = await createFramescaperVideoExportImageExecutionTimelineImageV16({ profile: PROFILE, project: value.project,
		foundationPlan: imagePlan(value), signal: new AbortController().signal, assertCurrent() {},
		store: { async loadMediaAsset() { return new Blob([new Uint8Array(value.pack.bytes)]); } } }); assert.ok(execution);
	const frame = createVideoExactPictureExportFrameSource({ sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
		canvas: { width: 2, height: 2, frameRate: { num: 1, den: 1 }, fit: 'contain', backgroundColor: '#00000000' } }).frame(0);
	const request = { frame, sequencePosition: { num: 0, den: 1 }, width: 2, height: 2, signal: stop.signal };
	try {
		await execution.resolve(request);
		queueMicrotask(() => { stop.abort(reason); request.signal = new AbortController().signal; });
		const result = await Promise.resolve(execution.resolve(request)).then(() => ({ rejected: false, error: undefined }), error => ({ rejected: true, error: error as unknown }));
		assert.equal(result.rejected, true); assert.equal(result.error, reason); assert.equal(traps, 0);
	} finally { await execution.dispose(); }
});

test('TimelineImage resource cancellation joins the held body and close before any output publication', async t => {
	const writes = dom(t), value = fixture(), held = deferred(), entered = deferred(), stop = new AbortController();
	let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw Error('opaque'); }, getPrototypeOf() { inspections++; throw Error('opaque'); }, getOwnPropertyDescriptor() { inspections++; throw Error('opaque'); } });
	let bodySignal: AbortSignal | undefined;
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: value.project, width: 2, height: 2,
		store: { async loadMediaAsset(key: string, options?: { signal?: AbortSignal }) {
			if (key === 'image-source') return new Blob([new Uint8Array(value.pack.bytes)]);
			assert.equal(key, ref.storageKey); bodySignal = options?.signal; entered.release(); await held.promise; return new Blob([lutBytes]);
		} } as never }); assert.ok(session); const before = writes.length;
	let settled = false, closed = false;
	const result = session.renderExact!(renderRequest(stop.signal)).then(() => ({ rejected: false, error: undefined }), error => ({ rejected: true, error: error as unknown })).then(value => { settled = true; return value; });
	await entered.promise; stop.abort(reason); assert.equal(bodySignal?.reason, reason); const close = session.close!().then(() => { closed = true; });
	await Promise.resolve(); assert.equal(settled, false); assert.equal(closed, false); held.release();
	const outcome = await result; assert.equal(outcome.rejected, true); assert.equal(outcome.error, reason); await close;
	assert.equal(writes.length, before); assert.equal(inspections, 0);
});

test('same-revision TimelineImage drift during a held LUT refuses publication after the full body join', async t => {
	const writes = dom(t), value = fixture(), held = deferred(), entered = deferred();
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: value.project, width: 2, height: 2,
		store: { async loadMediaAsset(key: string) {
			if (key === 'image-source') return new Blob([new Uint8Array(value.pack.bytes)]);
			entered.release(); await held.promise; return new Blob([lutBytes]);
		} } as never }); assert.ok(session); const before = writes.length;
	const render = session.renderExact!(renderRequest(new AbortController().signal)); void render.catch(() => undefined);
	await entered.promise; Object.assign(value.project, { title: 'same revision changed' }); held.release();
	await assert.rejects(render, /preview is stale/u); assert.equal(writes.length, before); await session.close!();
});

test('selected TimelineImage export preserves cube and image painter order through the real pinned H264 encoder', async () => {
	const value = fixture(), canonicalProject = value.project as unknown as Readonly<Record<string, unknown>>;
	const encoder = await createPinnedExportEncoderV1(), input = new Uint8Array(original); let captures = 0, offline = 0;
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE, {
		captureExactFrame() { captures++; return { width: 2, height: 2, pixels: input }; },
		async encodeOffline(request) {
			offline++; const compositor = request.rgbaCompositor; assert.ok(compositor);
			const clips = request.project.clips as readonly Readonly<{ id: string; videoEffects?: readonly unknown[] }>[];
			assert.deepEqual(clips.find(clip => clip.id === 'video-clip')!.videoEffects, []);
			assert.equal(request.startFrame, 0); assert.equal(request.endFrame, 48_000);
			const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: Number(value.project.sampleRate),
				startFrame: request.startFrame!, endFrame: request.endFrame!, canvas: request.canvas }); assert.equal(frameSource.frameCount, 1);
			return encodeVideoKeyframeVideo(encoder.editor, { frameSource, format: request.format, quality: request.quality,
				signal: request.signal, assertCurrent: request.assertCurrent, producer: { width: 2, height: 2, byteLength: 16,
					async produce(frame, target) {
						const layers = renderRequest(request.signal).mediaLayers.map(layer => ({ ...layer, entries: layer.entries.map(entry => ({
							...entry, effects: [], presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
						})) }));
						await compositor({ frame, layers, width: 2, height: 2, rgba: target, signal: request.signal });
						assert.deepEqual(Array.from(target), expected);
					}, dispose() {},
				} });
		}, async encodeOfflineToSink() { throw Error('This bounded fixture never opens a sink.'); },
	}, { async loadMediaAsset(key: string) {
		if (key === 'image-source') return new Blob([new Uint8Array(value.pack.bytes)]);
		assert.equal(key, ref.storageKey); assert.equal(captures, 1); return new Blob([lutBytes]);
	} });
	try {
		const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: { decoderProjection: true },
			audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
		const rate = { num: 1, den: 1 };
		const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
			canvas: { width: 2, height: 2, frameRate: rate, fit: 'contain', backgroundColor: '#00000000' } }); assert.ok(plan);
		const result = await strategy.encode({ canonicalProject, exportProject, plan, timingBySourceId: new Map(),
			timingViewsBySourceId: new Map([['video-source', { kind: 'cfr', rate, frameCount: 1 }]]),
			videoBlobs: new Map([['video-source', new Blob(['capture seam'])]]), audioMix: null, editorFfmpeg: {}, webCodecs: null,
			signal: new AbortController().signal, maximumOutputBytes: 1024 * 1024, assertCurrent() {} });
		assert.equal(offline, 1); assert.equal(captures, 1); assert.deepEqual(Array.from(input), original); assert.deepEqual(encoder.inputCopies, [expected]);
		assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// Pre-encode straight RGBA is literal-exact. H264/YUV420 delivery is
		// lossy and drops alpha; the reference uses the same observed parameters.
		assert.deepEqual(encoder.decode(result.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(expected))));
	} finally { encoder.close(); }
});

for (const neutral of [{ ...effect, enabled: false }, { ...effect, params: { lut: null } }]) test(`current TimelineImage ${neutral.enabled ? 'null' : 'disabled'} cube preserves image composition without LUT body IO`, async t => {
	const writes = dom(t), value = fixture(false, [neutral]); let images = 0;
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: value.project, width: 2, height: 2,
		store: { async loadMediaAsset(key: string) { assert.equal(key, 'image-source'); images++; return new Blob([new Uint8Array(value.pack.bytes)]); } } as never });
	assert.ok(session); try {
		assert.equal(session.exactPlaying, true); await session.renderExact!(renderRequest(new AbortController().signal, false, [neutral]));
		assert.deepEqual(writes.at(-1), [255,0,0,255,0,255,0,255,255,255,255,255,255,255,255,255]); assert.equal(images, 1);
	} finally { await session.close!(); }
});
