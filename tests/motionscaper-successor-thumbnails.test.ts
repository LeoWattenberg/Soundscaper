/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperSuccessorProjectBinThumbnail, createFramescaperSuccessorTimelineFilmstrip, createFramescaperSuccessorSourceFrame } from '../src/framescaper/editor-composition-link-thumbnails.ts';
import { createVideoFilmstripFrameRequests } from '../src/common/editor/ui/timeline/video-filmstrip-frame-requests.ts';
const kit = await CanvasKitInit();
function fixture(opacity = 1) {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', width: 4, height: 2, durationFrames: 3, frameRate: { num: 30000, den: 1001 } });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 3, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([2, 2]) } });
	const animated = { ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { enabled: true, source: '[time * 60, 0, 0]', references: [] } } } };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, compositions: [{ ...motion.compositions[0], layers: [animated] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const clip = { kind: 'video', id: 'clip', sourceId: 'linked', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, retimeMap: null, videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity } };
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source], clips: [clip], projectBin: { clips: [{ ...clip, id: 'bin', sourceInFrame: 1, sourceFrameCount: 2, sequenceFrameCount: 2 }] }, tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })], sequences: [{ id: 'seq', rate: offer.output.frameRate, trackIds: ['track'] }], primarySequenceId: 'seq' }), compositionLinks: [linked.link] };
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded original is permitted'); } });
	const store = { loadMediaAsset: () => Promise.reject(new Error('Virtual media lookup')), loadSource: () => Promise.reject(new Error('Virtual PCM lookup')) } as never;
	return { project, width: 4, height: 2, store, acquire: async () => ({ rasterizer, async release() {} }) };
}
test('M10 linked bin and source monitor pixels use retained exact source ordinals without media URLs', async () => {
	const options = fixture(); const first = await createFramescaperSuccessorSourceFrame({ ...options, sourceId: 'linked', sourceFrame: 0 });
	const second = await createFramescaperSuccessorSourceFrame({ ...options, sourceId: 'linked', sourceFrame: 1 });
	const bin = await createFramescaperSuccessorProjectBinThumbnail({ ...options, clipId: 'bin' });
	assert.ok(first && second && bin); assert.notDeepEqual(first.pixels, second.pixels); assert.deepEqual(bin.pixels, second.pixels);
	assert.deepEqual([...first.pixels.slice(0, 4)], [255, 0, 0, 128]);
	await assert.rejects(createFramescaperSuccessorSourceFrame({ ...options, sourceId: 'linked', sourceFrame: 3 }), /duration|frame/u);
});
test('M10 URL-free linked filmstrip retains exact Frame timing and authored opacity through real CanvasKit pixels', async () => {
	const frames = [0, 4000].map((timelineSample, index) => ({ key: String(index), clipId: 'clip', sourceId: 'linked', timelineSample, sourceAuthority: 'product-generated' as const }));
	const output = () => { let pixels = new Uint8Array(); return { drawable: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels) }) }) }, write(value: Uint8Array) { pixels = value.slice(); }, dispose() {} }; };
	const full = await createFramescaperSuccessorTimelineFilmstrip({ ...fixture(), frames, createOutput: output });
	const faded = await createFramescaperSuccessorTimelineFilmstrip({ ...fixture(0.25), frames, createOutput: output });
	assert.ok(full && faded); assert.equal(full.length, 2); assert.equal(full[0]!.pixels[3], 255); assert.ok(full[0]!.pixels[0]! > faded[0]!.pixels[0]!); assert.equal(full[1]!.pixels[0], 0);
	await assert.rejects(createFramescaperSuccessorTimelineFilmstrip({ ...fixture(), frames: [{ ...frames[0]!, sourceId: 'wrong' }], createOutput: output }), /source|authority/u);
});
test('M10 generated filmstrip request keeps exact timeline samples with no synthetic source URL', () => {
	const requests = createVideoFilmstripFrameRequests({ id: 'clip', sourceId: 'linked', timelineStartFrame: 0, durationFrames: 100 }, [{ key: 'frame', sourceUrl: null, point: { timelineFrame: 42.4 } }], 'product-generated');
	assert.deepEqual(requests, [{ key: 'frame', clipId: 'clip', sourceId: 'linked', timelineSample: 42, sourceAuthority: 'product-generated' }]);
});

test('M10 generated ownership recognizes only the exact captured playback projection', async () => {
	const { createFramescaperSuccessorPlayback } = await import('../src/framescaper/editor-project-successor-playback.ts');
	const { bindFramescaperSuccessorCompositionPreview } = await import('../src/framescaper/editor-composition-link-preview-controller.ts');
	const { productVideoVisualPreviewRuntimeFor } = await import('../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts');
	const options = fixture(); const controller = {}; const playback = createFramescaperSuccessorPlayback(options.store);
	bindFramescaperSuccessorCompositionPreview({ controller, store: options.store, readAsset: async () => null });
	const runtime = productVideoVisualPreviewRuntimeFor(controller)!; const projection = playback.projectForPlayback(options.project).project;
	assert.equal(runtime.generatedSources?.ownsSource(projection, 'linked'), true);
	assert.equal(runtime.generatedSources?.ownsSource({ ...projection }, 'linked'), false);
	assert.ok(runtime.createProjectBinThumbnail && runtime.createTimelineFilmstrip);
});
test('M10 mixed image and linked filmstrip cells retain request order without reading a virtual body', async () => {
	const { imageFixture, imageClip, assetStore } = await import('./helpers/framescaper-timeline-image-preview-fixture.ts');
	const options = fixture(); const image = imageFixture('image', 4, 2);
	const command = { type: 'batch', commands: [
		{ type: 'track/add', sequenceId: 'seq', track: createVideoTrack({ id: 'images', clipIds: [] }) },
		{ type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source },
		{ type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null, clip: imageClip('image-clip', image.source.id, { sequenceId: 'seq', sequenceFrameCount: 3 }), placement: { scope: 'timeline', trackId: 'images' } },
	] };
	const { framescaperSuccessorBaselineProject } = await import('../src/framescaper/editor-project-successor-commands.ts');
	const { applyFramescaperProjectCommand } = await import('../src/framescaper/editor-project-commands.ts');
	const { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } = await import('../src/framescaper/editor-project-runtime-profile.ts');
	const before = framescaperSuccessorBaselineProject(options.project);
	const after = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, before, command);
	assert.deepEqual(after.sources.find(source => source.id === 'linked'), before.sources.find(source => source.id === 'linked'));
	const project = { ...after, schemaVersion: 2, compositionLinks: options.project.compositionLinks };
	let pixels = new Uint8Array(); const result = await createFramescaperSuccessorTimelineFilmstrip({ ...options, project, store: assetStore([image]),
		createOutput: () => ({ drawable: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels) }) }) }, write(value) { pixels = value.slice(); }, dispose() {} }),
		frames: [{ key: 'image', clipId: 'image-clip', sourceId: image.source.id, timelineSample: 0, sourceUrl: 'product-image:image' }, { key: 'linked', clipId: 'clip', sourceId: 'linked', timelineSample: 0, sourceAuthority: 'product-generated' }],
	}); assert.ok(result); assert.deepEqual(result.map(frame => frame.key), ['image', 'linked']); assert.equal(result[0]!.pixels[0], 37); assert.ok(result[1]!.pixels[0]! > 100);
});

test('M10 generated thumbnails refuse borrowed URLs, excessive batches and cancellation before native acquisition', async () => {
	const options = fixture(); let acquisitions = 0;
	const acquire = async () => { acquisitions++; return options.acquire(); };
	await assert.rejects(createFramescaperSuccessorTimelineFilmstrip({ ...options, acquire, frames: [{ key: 'bad', clipId: 'clip', sourceId: 'linked', timelineSample: 0, sourceUrl: 'blob:forged' }], decodeSource: async () => { throw new Error('URL decoder was invoked'); } }), /URL-free composition authority/u);
	await assert.rejects(createFramescaperSuccessorTimelineFilmstrip({ ...options, acquire, width: 4096, height: 4096, frames: [0, 1].map(key => ({ key: String(key), clipId: 'clip', sourceId: 'linked', timelineSample: key, sourceAuthority: 'product-generated' as const })) }), /budget/u);
	const abort = new AbortController(); abort.abort(); await assert.rejects(createFramescaperSuccessorSourceFrame({ ...options, acquire, sourceId: 'linked', sourceFrame: 0, signal: abort.signal }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(acquisitions, 0);
});
