/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { captureImageExportTextSelection, restoreImageExportTextSelection } from '../src/common/editor/ui/PhotoTextWatermarkFields.tsx';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { dialogSettingsFromPreset, presetSettingsFromDialog } from '../src/common/editor/ui/export-preset-model.ts';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { withImageExportTextFrameV1 } from '../src/common/editor/imaging/image-export-text-frame-v1.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeVideoEncoderRequest, VideoKeyframeVideoEncoderResult } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, type FramescaperProjectFinishingOptions } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFixture as createServiceFixture } from './helpers/export-service-fixture.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';
import { installWebCodecsSupport } from './helpers/webcodecs-test-environment.ts';

let restoreWebCodecs: () => void;
test.beforeEach(() => { restoreWebCodecs = installWebCodecsSupport(); Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true,
	value: class { static async isConfigSupported() { return { supported: true }; } } }); });
test.afterEach(() => { restoreWebCodecs(); });

const WIDTH = 2, HEIGHT = 2;
const TEXT = Object.freeze({ schemaVersion: 1, text: 'Readable ©', font: 'inter-600-latin', color: '#ffffff', anchor: 'bottom-right', widthFraction: 0.5, marginFraction: 0, opacity: 0.5 });

async function fixture(kind: 'generator' | 'still' | 'keyed', outputSpace: 'srgb' | 'rec709' = 'srgb', direct = false) {
	const expected = Uint8Array.from(Array.from({ length: 4 }, () => [0, 0, 255, 255]).flat()), events: string[] = [], seen: Uint8Array[] = [];
	const png = await encodePixelFramePngV1({ descriptor: { schemaVersion: 1, width: WIDTH, height: HEIGHT, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: expected });
	const blob = new Blob([png], { type: 'image/png' }), digest = createHash('sha256').update(png).digest('hex'), options = framescaperV20Options();
	options.sources = (options.sources as Record<string, unknown>[]).map(source => source.kind === 'video' ? { ...source, width: WIDTH, height: HEIGHT,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 10, den: 1 } } } : source);
	options.clips = kind === 'keyed' ? (options.clips as Record<string, unknown>[]).filter(clip => clip.kind === 'video') : [{ schemaVersion: 1, kind,
		id: 'picture-clip', sourceId: 'picture-source', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		...(kind === 'generator' ? { sourceInFrame: 0, sourceFrameCount: 10 } : {}) }];
	options.tracks = (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, clipIds: track.id === 'video-track' ? [kind === 'keyed' ? 'video-clip' : 'picture-clip'] : [] }));
	options.videoTransitionsByTrackId = { 'video-track': [] };
	options.sequences = [...options.sequences as Record<string, unknown>[], { id: 'unrelated', rate: { num: 10, den: 1 }, trackIds: [] }];
	options.finishing = { colorContexts: ['unrelated', 'main-sequence'].map(sequenceId => ({ schemaVersion: 1, sequenceId, workingSpace: 'linear-rec709-d65',
		outputSpace: sequenceId === 'unrelated' ? outputSpace === 'srgb' ? 'rec709' : 'srgb' : outputSpace, alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' })) };
	options.visualModel = { stillSources: kind === 'still' ? [{ schemaVersion: 1, kind, id: 'picture-source', name: 'Plate', mimeType: 'image/png',
		storageKey: 'plate-storage', contentSha256: digest, width: WIDTH, height: HEIGHT, hasAlpha: false }] : [],
		generatorSources: kind === 'generator' ? [{ schemaVersion: 1, kind, id: 'picture-source', name: 'Solid', width: WIDTH, height: HEIGHT,
			frameRate: { num: 10, den: 1 }, frameCount: 100, generator: { kind: 'solid', color: '#0000ffff' } }] : [],
		adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [] };
	const project = createFramescaperProjectFinishing(PROFILE, options as FramescaperProjectFinishingOptions);
	const sampleRate = project.sampleRate; assert.ok(typeof sampleRate === 'number'); let afterEncode = async () => undefined;
	const identity = (): VideoKeyframeVideoEncoderResult => ({ bytes: Uint8Array.of(1, 2, 3), byteLength: 3, videoEncoder: 'ffmpeg', codec: 'h264',
		format: 'mp4', extension: '.mp4', mimeType: 'video/mp4', frameCount: 1, rgbaChunkCount: 1, outputChunkCount: 1 });
	const produce = async (request: VideoKeyframeVideoEncoderRequest) => { const target = new Uint8Array(request.producer.byteLength);
		await request.producer.produce(request.frameSource.frame(0), target, { signal: request.signal! }); seen.push(target.slice()); events.push('encode'); await afterEncode(); };
		const produceOffline = async (request: VideoKeyframeOfflineVideoExportRequest) => {
			const frame = createVideoExactPictureExportFrameSource({ sampleRate, startFrame: request.startFrame!, endFrame: request.endFrame!, canvas: request.canvas }).frame(0);
			const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
			const layers = [{ trackId: 'video-track', entries: [{ clipId: 'video-clip', sourceId: 'video-source', presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
				displayWidth: WIDTH, displayHeight: HEIGHT, effects: [], intervalProgress: 0, renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 },
					sourcePixels: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }, sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 } }] }];
			assert.ok(request.rgbaCompositor); await request.rgbaCompositor({ frame, layers, width: WIDTH, height: HEIGHT, rgba, signal: request.signal });
			await request.rgbaPostprocessor?.({ frame, width: WIDTH, height: HEIGHT, rgba, signal: request.signal }); seen.push(rgba.slice()); events.push('encode'); await afterEncode(); return identity();
		};
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, {
		captureExactFrame: () => ({ width: WIDTH, height: HEIGHT, pixels: expected }),
		encodeOffline: produceOffline,
		encodeOfflineToSink: async (request, destination) => { await produceOffline(request); await destination.open(3); await destination.write(Uint8Array.of(1,2,3));
			const output = await destination.close(), { bytes: _bytes, ...rest } = identity(); return { ...rest, output }; },
		encodePicture: async (_owner, request) => { await produce(request); return identity(); },
		encodePictureToSink: async (_owner, request, destination) => { await produce(request); await destination.open(3); await destination.write(Uint8Array.of(1,2,3));
			const output = await destination.close(), { bytes: _bytes, ...rest } = identity(); return { ...rest, output }; },
	}, { loadMediaAsset: async () => blob, decodeStillAsset: async () => ({ width: WIDTH, height: HEIGHT, pixels: expected.slice() }) }, undefined,
	() => ({ resolve: () => [], dispose: () => { events.push('dispose'); } }));
	const service = createServiceFixture(), textPixels = Uint8Array.of(255, 255, 255, 255);
	const withText: typeof withImageExportTextFrameV1 = async (_value, consume) => { events.push('text-open'); try {
		return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: textPixels });
	} finally { textPixels.fill(0); events.push('text-close'); } };
	const runtime = { ...service.runtime, getProject: () => project, options: { productVideoExportStrategy: strategy, withImageExportTextFrame: withText },
		store: { loadMediaAsset: async () => new Blob([Uint8Array.of(1)]) }, ...(direct ? { fileService: { ...service.runtime.fileService, prepareSave: async () => ({ mode: 'stream',
			createWritable: async () => new WritableStream<Uint8Array>({ write() { events.push('write'); } }), bytesWritten: () => 3,
			commit: async () => { events.push('commit'); return { fileName: 'Framescaper-V20.mp4', method: 'file-system-access', size: 3 }; }, abort: async () => { events.push('abort'); } }) } } : {}) };
	const exportVideo = createEditorVideoExportAction(runtime, async () => assert.fail('Picture-only cannot render audio'));
	return { exportVideo, service, events, textPixels, expected, seen, runtime, holdCodec: (promise: Promise<void>) => { afterEncode = async () => { await promise; }; } };
}

for (const kind of ['generator', 'still', 'keyed'] as const) for (const profile of ['srgb', 'rec709'] as const) {
	test(`real common service and selected ${kind} export mark the captured ${profile} primary output, not the unrelated context`, async () => {
		const f = await fixture(kind, profile); const result = await f.exportVideo({ format: 'video-mp4', canvas: { width: WIDTH, height: HEIGHT, frameRate: { num: 10, den: 1 } }, textWatermark: TEXT });
		assert.deepEqual(f.service.errors, []); assert.ok(result); const expected = f.expected.slice(); expected.set(profile === 'srgb' ? [188,188,255,255] : [180,180,255,255], 12);
		assert.deepEqual(f.seen, [expected]); assert.ok(f.textPixels.every(value => value === 0));
		assert.ok(f.events.indexOf('text-close') > f.events.indexOf('encode'));
	});
}

test('Frame direct destination commits only after complete codec and text retirement', async () => {
	const f = await fixture('keyed', 'srgb', true); await f.exportVideo({ format: 'video-mp4', textWatermark: TEXT });
	assert.deepEqual(f.service.errors, []); assert.ok(f.events.indexOf('commit') > f.events.indexOf('text-close'));
	assert.ok(f.events.indexOf('text-close') > f.events.indexOf('write'));
});

test('Frame default-off and zero-opacity leave the real composed output and reader untouched', async () => {
	for (const zero of [false, true]) {
		const f = await fixture('generator'); await f.exportVideo({ format: 'video-mp4', ...(zero ? { textWatermark: { ...TEXT, opacity: 0 } } : {}) });
		assert.deepEqual(f.service.errors, []); assert.deepEqual(f.seen, [f.expected]); assert.equal(f.events.includes('text-open'), false);
	}
});

test('common Frame retirement joins the complete codec before text wipe and destination publication', async () => {
	const f = await fixture('generator'), release = deferred<void>(); f.holdCodec(release.promise);
	const work = f.exportVideo({ format: 'video-mp4', textWatermark: TEXT });
	try {
		await waitFor(() => f.events.includes('encode') || f.service.errors.length > 0, 'held real product codec'); assert.deepEqual(f.service.errors, []);
		assert.equal(f.textPixels[0], 255); f.service.state.exportAbort!.abort(); assert.equal(await remainsPending(work), true);
		assert.equal(f.events.includes('text-close'), false); assert.equal(f.service.downloads.length, 0);
	} finally { release.resolve(); }
	assert.equal(await work, null); assert.ok(f.textPixels.every(value => value === 0)); assert.equal(f.service.downloads.length, 0);
	assert.ok(f.service.calls.includes('finish-task'));
});

test('common Frame captures text scalars and reader receiver before its first borrowed await', async () => {
	const f = await fixture('generator'), input = { ...TEXT };
	const work = f.exportVideo({ format: 'video-mp4', textWatermark: input });
	input.widthFraction = 1; input.opacity = 0;
	f.runtime.options.withImageExportTextFrame = async () => assert.fail('Uncaptured replacement reader');
	await work; assert.deepEqual(f.service.errors, []); const expected = f.expected.slice(); expected.set([188,188,255,255], 12);
	assert.deepEqual(f.seen, [expected]); assert.equal(f.events.includes('text-close'), true);
});

test('real Frame File-export dialog offers text controls only for the opted-in video delivery', async () => {
	const mounted = await mountedExportDialog({ productId: 'framescaper', video: true });
	try {
		assert.equal(mounted.dom.find('[data-image-export-text-enabled]'), null);
		await mounted.chooseFormat(ENGLISH_COPY.videoExportMp4);
		assert.equal(reactProps(mounted.dom.one('[data-image-export-text-enabled]')).checked, false);
		await mounted.startExport();
		assert.equal(Object.hasOwn(mounted.requests[0]!, 'textWatermark'), false);
	} finally { await mounted.unmount(); }
});


test('Frame presets roundtrip the same admitted text; applying an older preset turns text off and rejects unsupported future glyphs', () => {
	const raw = { textWatermark: restoreImageExportTextSelection(TEXT) }, scalar = presetSettingsFromDialog(raw, 'video');
	assert.deepEqual(scalar.textWatermark, TEXT); const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'text', label: 'Text', kind: 'video', format: 'mp4', settings: scalar });
	const restored = dialogSettingsFromPreset(preset); assert.deepEqual(presetSettingsFromDialog(restored, 'video').textWatermark, TEXT);
	assert.equal(dialogSettingsFromPreset({ ...preset, settings: {} }).textWatermark, undefined);
	assert.equal(captureImageExportTextSelection(restoreImageExportTextSelection(undefined)), undefined);
	assert.throws(() => validateDeliveryPreset({ ...preset, settings: { textWatermark: { ...TEXT, text: '漢' } } }), /does not support/u);
});
