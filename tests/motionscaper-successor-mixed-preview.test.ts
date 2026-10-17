/* SPDX-License-Identifier: AGPL-3.0-only */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { createFramescaperSuccessorCompositionPreview } from '../src/framescaper/editor-composition-link-preview.ts';
import { assetStore, drawableFactory } from './helpers/framescaper-timeline-image-preview-fixture.ts';
import { framescaperTimelineImageExactFoundation } from '../src/framescaper/editor-timeline-image-exact-foundation.ts';
import { framescaperSuccessorBaselineProject } from '../src/framescaper/editor-project-successor-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { createFramescaperVideoExportStrategySuccessor } from '../src/framescaper/video-export-strategy-successor.ts';
import { consumeFramescaperVideoFrames } from '../src/framescaper/video-export-frame-consumer.ts';
import { consumeVideoKeyframeOfflineFrames } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { createVideoKeyframeOfflineRgbaRenderer } from '../src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { decodeManagedSdrOutputPixelV1, encodeManagedSdrLinearPixelV1 } from '../src/common/editor/video-color-management-v27.ts';

import { motionscaperMixedPreviewFixture as fixture } from './helpers/motionscaper-mixed-preview-fixture.ts';

const kit = await CanvasKitInit();
function previewDom(t: TestContext) {
	const root = globalThis as unknown as Record<string, unknown>;
	const previous = { document: root.document, ImageData: root.ImageData };
	const canvases: { width: number; height: number }[] = [];
	root.document = { createElement() {
		const canvas = { width: 0, height: 0, getContext: (kind: string) => kind === 'webgl2' ? null : ({ putImageData() {}, clearRect() {} }) };
		canvases.push(canvas); return canvas;
	} };
	root.ImageData = class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} };
	t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete root[key]; else root[key] = value; } });
	return canvases;
}

async function exportPictures(value: ReturnType<typeof fixture>) {
	const { project, image, linked } = value;
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded linked body is permitted'); } });
	const surfaces = new WeakMap<object, Uint8Array>();
	const strategy = createFramescaperVideoExportStrategySuccessor({ store: assetStore([image]), readAsset: async () => null,
		acquire: async () => ({ rasterizer, async release() {} }),
		createDrawable() { const drawable = {} as HTMLCanvasElement; return { drawable, present(pixels) { surfaces.set(drawable, pixels.slice()); }, dispose() { surfaces.delete(drawable); } }; },
		dependencies: {
			async encodeOffline() { throw new Error('Raw reference pictures are never encoded'); },
			async encodeOfflineToSink() { throw new Error('Raw reference pictures are never encoded'); },
			consumeOfflineFrames: (request, consume) => consumeVideoKeyframeOfflineFrames(request, consume, {
				createCanvas: () => ({ width: 4, height: 2, getContext() { throw new Error('Exact export needs no GL'); } }) as unknown as HTMLCanvasElement,
				async encodeVideo() { throw new Error('Raw reference pictures are never encoded'); },
				createResolver() { throw new Error('Generated-only picture needs no encoded-media resolver'); }, createRenderer: createVideoKeyframeOfflineRgbaRenderer,
			}),
			captureExactFrame(entry) { const pixels = surfaces.get((entry.video as { drawable: object }).drawable); assert.ok(pixels); return { width: 4, height: 2, pixels: pixels.slice() }; },
		},
	});
	const canonicalProject = project as Readonly<Record<string, unknown>>;
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: framescaperSuccessorBaselineProject(project), audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false, canvas: { width: 4, height: 2, frameRate: linked.offer.output.frameRate } }); assert.ok(plan);
	const views = new Map([['linked', { kind: 'vfr' as const, reference: linked.timing.reference, index: linked.timing.index }]]);
	const pictures: { sample: number; pixels: Uint8Array }[] = [];
	await consumeFramescaperVideoFrames(strategy, { canonicalProject, exportProject, plan, timingBySourceId: new Map([['linked', bindVideoSourceTimingView(views, linked.source)]]), timingViewsBySourceId: views,
		videoBlobs: new Map(), audioMix: null, editorFfmpeg: null, webCodecs: null, signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: undefined,
	}, async (request, output) => {
		assert.ok(output);
		for (const index of [0, 31]) {
			const frame = request.frameSource.frame(index); const pixels = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(frame, pixels, { signal: request.signal! });
			for (let offset = 0; offset < pixels.length; offset += 4) {
				const encoded = encodeManagedSdrLinearPixelV1(decodeManagedSdrOutputPixelV1(Array.from(pixels.subarray(offset, offset + 4), value => value / 255), output.encoding), 'srgb');
				pixels.set(encoded.map(value => Math.round(value * 255)), offset);
			}
			pictures.push({ sample: Math.round(frame.timelineSample), pixels });
		}
	});
	return pictures;
}

test('Motionscaper mixed exact foundation preserves image authority, sequence range and painter order without encoded proxies', () => {
	const { project } = fixture();
	const canonical = framescaperProjectTimelineImageFoundationShapeAssistance(framescaperSuccessorBaselineProject(project));
	const original = structuredClone(canonical);
	const foundation = framescaperTimelineImageExactFoundation(canonical);
	assert.deepEqual(canonical, original);
	assert.deepEqual((foundation.tracks as readonly { clipIds: readonly string[] }[]).map(track => track.clipIds), canonical.tracks.map(track => track.clipIds));
	const source = foundation.sources.find(source => source.id === 'image');
	assert.equal(source?.kind, 'generator');
	assert.deepEqual(Reflect.get(source!, 'generator'), { kind: 'solid', color: '#00000000' });
	assert.equal(Reflect.has(source!, 'storageKey'), false);
	const clip = (foundation.clips as readonly { id: string; kind: string }[]).find(clip => clip.id === 'image-clip');
	assert.equal(clip?.kind, 'generator');
	assert.equal(Reflect.get(clip!, 'sequenceFrameCount'), 60);
	assert.deepEqual(foundation.sequences, canonical.sequences);
});

test('Motionscaper linked picture and retained animated image produce one complete exact preview in either painter order', async (t) => {
	const canvases = previewDom(t);
	const outputs: Uint8Array[] = [];
	for (const above of [false, true]) {
		const value = fixture(above); const { project, image } = value;
		const expected = await exportPictures(value);
		const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded linked body is permitted'); } });
		let written = new Uint8Array();
		const session = await createFramescaperSuccessorCompositionPreview({ project, width: 4, height: 2, store: assetStore([image]),
			acquire: async () => ({ rasterizer, async release() {} }), createDrawable: drawableFactory([]), createOutput: () => ({ drawable: {}, write(pixels) { written = pixels.slice(); }, dispose() {} }),
		});
		assert.ok(session?.renderExact);
		assert.equal(canvases.some(canvas => canvas.width > 1 || canvas.height > 1), false, 'Logical image slots never allocate full-size canvases before image admission');
		try {
			const first = await session.renderExact({ timelineSample: 0, mediaLayers: [] });
			const cpu = Reflect.get(first, 'cpuFrame') as { pixels: Uint8Array } | undefined;
			assert.ok(cpu, 'A mixed timeline image must not reduce exact preview to unflattened layers');
			assert.deepEqual(cpu.pixels, written);
			assert.deepEqual(written, expected[0]!.pixels, 'Preview and the maintained export consumer compose identical retained pictures');
			assert.deepEqual(first.frame.ledger.omittedNodeIds, []);
			assert.deepEqual(first.frame.layers.flatMap(layer => layer.entries.map(entry => entry.sourceId)).sort(), ['image', 'linked']);
			outputs.push(written.slice());
			await session.renderExact({ timelineSample: expected[1]!.sample, mediaLayers: [] });
			assert.deepEqual(written, expected[1]!.pixels, 'Exact NTSC image ticks agree with random-access delivery');
			assert.notDeepEqual(written, cpu.pixels, 'The retained image advances on its own exact source ticks');
			await session.renderExact({ timelineSample: 0, mediaLayers: [] });
			assert.deepEqual(written, cpu.pixels, 'Random backward seeks preserve the accepted frame');
		} finally { session.dispose(); }
	}
	assert.notDeepEqual(outputs[0], outputs[1], 'Swapping tracks changes the half-alpha linked picture composition');
	assert.ok(outputs[0]![0]! > outputs[1]![0]! + 80, 'Red picture above the retained image is visible');
});

test('Motionscaper mixed preview releases allocated drawables when authenticated image startup fails', async (t) => {
	const canvases = previewDom(t); const { project } = fixture(); let disposals = 0;
	await assert.rejects(createFramescaperSuccessorCompositionPreview({ project, width: 4, height: 2,
		store: { loadMediaAsset: async () => null } as never, acquire: async () => { throw new Error('Failed image startup must not acquire linked rendering'); },
		createOutput: () => ({ drawable: {}, write() {}, dispose() { disposals++; } }),
	}), /unavailable/u);
	assert.equal(disposals, 1); assert.ok(canvases.length > 0);
	assert.equal(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), true);
});

test('Motionscaper mixed preview disposal aborts an in-flight linked picture and never publishes stale pixels', async (t) => {
	const canvases = previewDom(t); const { project, image } = fixture(); let writes = 0, releases = 0, outputDisposals = 0;
	let startedResolve!: () => void, gateResolve!: () => void;
	const started = new Promise<void>(resolve => { startedResolve = resolve; }); const gate = new Promise<void>(resolve => { gateResolve = resolve; });
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded body'); } });
	const session = await createFramescaperSuccessorCompositionPreview({ project, width: 4, height: 2, store: assetStore([image]),
		async acquire() { startedResolve(); await gate; return { rasterizer, async release() { releases++; } }; },
		createOutput: () => ({ drawable: {}, write() { writes++; }, dispose() { outputDisposals++; } }),
	}); assert.ok(session?.renderExact);
	const rendered = session.renderExact({ timelineSample: 0, mediaLayers: [] });
	const rejected = assert.rejects(rendered, /abort|disposed/iu);
	await started; session.dispose(); gateResolve(); await rejected;
	await new Promise<void>(resolve => setTimeout(resolve, 0));
	assert.equal(writes, 0); assert.equal(releases, 1); assert.equal(outputDisposals, 1);
	assert.equal(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), true);
});

test('Motionscaper mixed CPU preview refuses a Frame adjustment requiring unavailable WebGL instead of omitting it', async (t) => {
	previewDom(t); const { project, image } = fixture(false, true); let writes = 0;
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded body'); } });
	const session = await createFramescaperSuccessorCompositionPreview({ project, width: 4, height: 2, store: assetStore([image]),
		acquire: async () => ({ rasterizer, async release() {} }), createOutput: () => ({ drawable: {}, write() { writes++; }, dispose() {} }),
	}); assert.ok(session?.renderExact);
	try {
		assert.deepEqual(session.resolve(0).adjustments[0]?.targetTrackIds, ['image-track', 'motion-track']);
		await assert.rejects(session.renderExact({ timelineSample: 0, mediaLayers: [] }), /WebGL2/iu);
		assert.equal(writes, 0);
	} finally { session.dispose(); }
});
