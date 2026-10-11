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
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperSuccessorCompositionPreview } from '../src/framescaper/editor-composition-link-preview.ts';
import { createVideoPreviewCompositorFallbackReport } from '../src/common/editor/ui/video-preview-compositor.js';
import { resolveVideoPreviewRenderIssue } from '../src/common/editor/ui/workspace/video-preview-fallback.ts';
import { shouldRenderExactProductVideoPreview } from '../src/common/editor/ui/workspace/video-preview-exact-render-policy.ts';

const kit = await CanvasKitInit();
function fixture() {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', width: 4, height: 2, durationFrames: 3, frameRate: { num: 30000, den: 1001 } });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 3, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([2, 2]) } });
	const animated = { ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { enabled: true, source: '[time * 60, 0, 0]', references: [] } } } };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, compositions: [{ ...motion.compositions[0], layers: [animated] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'linked', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, retimeMap: null }],
		tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] }), createVideoTrack({ id: 'images', clipIds: [] })], sequences: [{ id: 'seq', rate: offer.output.frameRate, trackIds: ['track', 'images'] }], primarySequenceId: 'seq',
	}), compositionLinks: [linked.link] };
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No encoded original is permitted'); } });
	return { project, rasterizer };
}
test('successor preview renders the actual Frame exact composition graph at saved source addresses after the sender closes', async () => {
	const { project, rasterizer } = fixture(); let written = new Uint8Array(); let releases = 0;
	const session = await createFramescaperSuccessorCompositionPreview({ project, width: 4, height: 2, store: {
		loadMediaAsset: () => Promise.reject(new Error('Virtual scenes must not request encoded media')), loadSource: () => Promise.reject(new Error('Virtual scenes must not request decoded PCM')),
	} as never, acquire: async () => ({ rasterizer, async release() { releases++; } }), createOutput: () => ({ drawable: {}, write(pixels) { written = pixels.slice(); }, dispose() {} }) });
	assert.ok(session?.renderExact); assert.equal(shouldRenderExactProductVideoPreview(session, 'playing'), true);
	try {
		const fallback = resolveVideoPreviewRenderIssue(createVideoPreviewCompositorFallbackReport(session.resolve(0).layers));
		assert.equal(fallback.requestedCompositionCount, 1); assert.deepEqual(fallback.omittedCompositionClipIds, ['clip']);
		const first = await session.renderExact({ timelineSample: 0, mediaLayers: [] }); const firstPixels = written.slice();
		const cpuFrame = Reflect.get(first, 'cpuFrame') as { width: number; height: number; pixels: Uint8Array } | undefined;
		assert.ok(cpuFrame, 'The exact finishing output must also be presentable without WebGL');
		assert.equal(Reflect.get(cpuFrame, 'encoding'), 'srgb');
		assert.equal(cpuFrame.width, 4); assert.equal(cpuFrame.height, 2); assert.deepEqual(cpuFrame.pixels, firstPixels);
		assert.equal(first.frame.layers.flatMap(layer => layer.entries).some(entry => entry.sourceId === 'linked'), true);
		assert.ok(firstPixels[0]! > 100); assert.equal(firstPixels[3], 255);
		await session.renderExact({ timelineSample: 4000, mediaLayers: [] }); assert.notDeepEqual(written, firstPixels); assert.equal(written[0], 0);
		await session.renderExact({ timelineSample: 0, mediaLayers: [] }); assert.deepEqual(written, firstPixels); assert.equal(releases, 2);
	} finally { session.dispose(); }
});
