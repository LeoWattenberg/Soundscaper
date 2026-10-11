/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperCompositionFrameSource } from '../src/framescaper/editor-composition-link-frame-source.ts';

const kit = await CanvasKitInit();
function fixture() {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', width: 4, height: 2, durationFrames: 3, frameRate: { num: 30000, den: 1001 } });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 3, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([2, 2]) } });
	const animated = { ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { enabled: true, source: '[time * 60, 0, 0]', references: [] } } } };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, compositions: [{ ...motion.compositions[0], layers: [animated] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source] }), compositionLinks: [linked.link] };
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('Encoded asset access is forbidden for this retained solid.'); } });
	return { project, linked, rasterizer };
}
test('successor frame routing uses retained composition ordinals for forward, reverse and arbitrary seeks without encoded media', async () => {
	const { project, rasterizer } = fixture(); let leases = 0, releases = 0;
	const source = createFramescaperCompositionFrameSource({ project, purpose: 'final', acquire: async () => { leases++; return { rasterizer, async release() { releases++; } }; } });
	const signal = new AbortController().signal;
	try {
		assert.equal(source.ownsSource('linked'), true); assert.equal(source.ownsSource('ordinary'), false); assert.equal(await source.capture({ sourceId: 'ordinary' }, signal), null);
		const last = await source.capture({ sourceId: 'linked', presentationDescriptor: { drawableSourceFrame: 2 } }, signal); assert.ok(last);
		const first = await source.capture({ sourceId: 'linked', presentationDescriptor: { drawableSourceFrame: 0 } }, signal); assert.ok(first);
		assert.notDeepEqual(last.pixels, first.pixels); assert.deepEqual([...first.pixels.slice(0, 4)], [255, 0, 0, 128]);
		const saved = last.pixels.slice(); last.pixels.fill(0);
		assert.deepEqual((await source.resolve({ sourceId: 'linked', sourceFrame: 2, width: 4, height: 2, signal })).pixels, saved);
		assert.equal(leases, 2); assert.equal(releases, 2);
		await assert.rejects(source.resolve({ sourceId: 'linked', sourceFrame: 3, width: 4, height: 2, signal }), /frame|duration/iu);
		await assert.rejects(source.capture({ sourceId: 'linked', presentationDescriptor: { drawableSourceFrame: -1 } }, signal), /frame/iu);
	} finally { await source.dispose(); }
});
test('successor source cache evicts within its budget and failed renders remain retryable without replacing pinned revision', async () => {
	const { project, rasterizer } = fixture(); let fail = true, leases = 0, releases = 0;
	const source = createFramescaperCompositionFrameSource({ project, purpose: 'preview', maximumCacheBytes: 32, acquire: async (offer) => {
		assert.equal(offer.revision.digest, project.compositionLinks[0]!.acceptedDigest); leases++;
		return { rasterizer: fail ? { ...rasterizer, async rasterize() { throw new Error('Planned scene failure'); } } : rasterizer, async release() { releases++; } };
	} }); const signal = new AbortController().signal;
	try {
		await assert.rejects(source.resolve({ sourceId: 'linked', sourceFrame: 0, width: 4, height: 2, signal }), /Planned scene failure/u); fail = false;
		await source.resolve({ sourceId: 'linked', sourceFrame: 0, width: 4, height: 2, signal });
		await source.resolve({ sourceId: 'linked', sourceFrame: 1, width: 4, height: 2, signal });
		await source.resolve({ sourceId: 'linked', sourceFrame: 0, width: 4, height: 2, signal });
		assert.equal(leases, 4); assert.equal(releases, 4); assert.equal(source.snapshot().cacheBytes, 32);
	} finally { await source.dispose(); }
});
test('successor source cancellation and disposal release the active closure before refusing later captures', async () => {
	const { project, rasterizer } = fixture(); let started!: () => void, finish!: () => void, releases = 0;
	const ready = new Promise<void>(resolve => { started = resolve; }); const wait = new Promise<void>(resolve => { finish = resolve; });
	const source = createFramescaperCompositionFrameSource({ project, purpose: 'final', acquire: async () => { started(); await wait; return { rasterizer, async release() { releases++; } }; } });
	const pending = source.resolve({ sourceId: 'linked', sourceFrame: 0, width: 4, height: 2, signal: new AbortController().signal });
	const rejected = assert.rejects(pending, { name: 'AbortError' }); await ready; const close = source.dispose(); finish(); await rejected; await close;
	assert.equal(releases, 1); assert.equal(source.snapshot().cacheBytes, 0);
	await assert.rejects(source.capture({ sourceId: 'linked', presentationDescriptor: { drawableSourceFrame: 0 } }, new AbortController().signal), /closed|disposed/u);
});
