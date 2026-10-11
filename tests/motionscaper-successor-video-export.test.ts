/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeFramescaperVideoFrames } from '../src/framescaper/video-export-frame-consumer.ts';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { framescaperSuccessorBaselineProject } from '../src/framescaper/editor-project-successor-commands.ts';
import { createFramescaperVideoExportStrategySuccessor } from '../src/framescaper/video-export-strategy-successor.ts';
import { consumeVideoKeyframeOfflineFrames, encodeVideoKeyframeOfflineVideo, encodeVideoKeyframeOfflineVideoToSink, type VideoKeyframeOfflineVideoExportDependencies } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { createVideoKeyframeOfflineRgbaRenderer } from '../src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperVideoExportDispositionFinishingFor } from '../src/framescaper/video-export-strategy-finishing.ts';
import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/export/product-video-export-strategy.ts';

const kit = await CanvasKitInit();
function fixture() {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', width: 4, height: 2, durationFrames: 3, frameRate: { num: 30, den: 1 } });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 3, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([2, 2]) } });
	const animated = { ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { enabled: true, source: '[time * 60, 0, 0]', references: [] } } } };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, compositions: [{ ...motion.compositions[0], layers: [animated] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'linked', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, retimeMap: null }],
		tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })], sequences: [{ id: 'seq', rate: offer.output.frameRate, trackIds: ['track'] }], primarySequenceId: 'seq',
	}), compositionLinks: [linked.link] };
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded original is permitted'); } });
	return { project, rasterizer, linked };
}
for (const mode of ['encoded', 'raw-native'] as const) test(`successor ${mode} delivery renders saved Motion frames through the real keyed offline and Frame finishing pipelines`, async () => {
	const { project, rasterizer, linked } = fixture(); const pictures: Uint8Array[] = []; const surfaces = new WeakMap<object, Uint8Array>();
	let drawablesClosed = 0, rasterReleases = 0;
	const offline: VideoKeyframeOfflineVideoExportDependencies = {
		createCanvas: () => ({ width: 4, height: 2, getContext() { throw new Error('Exact CPU finishing needs no GL context'); } }) as unknown as HTMLCanvasElement,
		createResolver() { throw new Error('Generated-only export must not create an encoded-media resolver'); },
		createRenderer: createVideoKeyframeOfflineRgbaRenderer,
		async encodeVideo(_engine, request) {
			for (const index of [2, 0, 1]) { const rgba = new Uint8Array(request.producer.byteLength); await request.producer.produce(request.frameSource.frame(index), rgba, { signal: request.signal! }); pictures[index] = rgba; }
			const bytes = Uint8Array.of(1, 2, 3); return { bytes, byteLength: 3, videoEncoder: 'ffmpeg', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4', frameCount: 3, rgbaChunkCount: 3, outputChunkCount: 1 };
		},
	};
	const dependencies: FramescaperVideoExportStrategyFinishingDependencies = {
		consumeOfflineFrames: (request, consume) => consumeVideoKeyframeOfflineFrames(request, consume, offline),
		encodeOffline: request => encodeVideoKeyframeOfflineVideo(request, offline), encodeOfflineToSink: (request, sink) => encodeVideoKeyframeOfflineVideoToSink(request, sink, offline),
		captureExactFrame(entry) { const video = entry.video as Readonly<{ drawable: object }>; const pixels = surfaces.get(video.drawable); assert.ok(pixels); return { width: 4, height: 2, pixels: pixels.slice() }; },
	};
	const strategy = createFramescaperVideoExportStrategySuccessor({ store: {} as never, readAsset: async () => null, dependencies,
		acquire: async () => ({ rasterizer, async release() { rasterReleases++; } }),
		createDrawable() { const drawable = {} as HTMLCanvasElement; return { drawable, present(pixels) { surfaces.set(drawable, pixels.slice()); }, dispose() { surfaces.delete(drawable); drawablesClosed++; } }; },
	});
	const canonicalProject = project as Readonly<Record<string, unknown>>;
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: framescaperSuccessorBaselineProject(project), audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false, canvas: { width: 4, height: 2, frameRate: { num: 30, den: 1 } } }); assert.ok(plan);
	const view = { kind: 'vfr' as const, reference: linked.timing.reference, index: linked.timing.index }; const views = new Map([['linked', view]]);
	const request: ProductVideoExportStrategyEncodeRequest = { canonicalProject, exportProject, plan, timingBySourceId: new Map([['linked', bindVideoSourceTimingView(views, linked.source)]]), timingViewsBySourceId: views,
		videoBlobs: new Map(), audioMix: null, editorFfmpeg: { runVideoKeyframeEncoderOperation() { throw new Error('Injected compression only'); } }, webCodecs: null, signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: undefined };
	if (mode === 'encoded') { const result = await strategy.encode(request); assert.equal(result.byteLength, 3); }
	else await consumeFramescaperVideoFrames(strategy, request, async request => {
		for (const index of [2, 0, 1]) { const rgba = new Uint8Array(request.producer.byteLength); await request.producer.produce(request.frameSource.frame(index), rgba, { signal: request.signal! }); pictures[index] = rgba; }
	});
	assert.ok(pictures[0]![0]! > 100); assert.equal(pictures[0]![3], 255); assert.equal(pictures[2]![0], 0); assert.notDeepEqual(pictures[0], pictures[2]);
	assert.equal(drawablesClosed, 1); assert.equal(rasterReleases, 3);
	assert.deepEqual(framescaperVideoExportDispositionFinishingFor(plan).unexplainedOmittedNodeIds, []);
	const execute = (value: ProductVideoExportStrategyEncodeRequest) => mode === 'encoded' ? strategy.encode(value) : consumeFramescaperVideoFrames(strategy, value, async () => {});
	await assert.rejects(async () => await execute({ ...request, canonicalProject: { ...canonicalProject } }), /canonical|project/iu);
	if (mode === 'raw-native') {
		const releasesBefore = rasterReleases;
		await assert.rejects(consumeFramescaperVideoFrames(strategy, request, async value => {
			await value.producer.produce(value.frameSource.frame(0), new Uint8Array(value.producer.byteLength), { signal: value.signal! });
			throw new Error('Native consumer refused its next frame');
		}), /Native consumer refused/iu);
		assert.equal(drawablesClosed, 2); assert.equal(rasterReleases, releasesBefore + 1);
	}
	Object.assign(project, { title: 'Changed after capture' });
	await assert.rejects(async () => await execute(request), /stale/iu);
});
