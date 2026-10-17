/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';

const kit = await CanvasKitInit();
const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const project = createMotionscaperProject({ id: 'dof', title: 'Focus', compositionId: 'main', width: 32, height: 32 });
const cardBase = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 1, 1, 1]) } });
const card: MotionLayer = { ...cardBase, is3D: true, transform: { ...cardBase.transform, position: motionVector([12, 12, 0]) } };
const cameraBase = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(32), near: 1, far: 1000,
	focusDistance: motionScalar(32), aperture: motionScalar(16) } });
const camera: MotionLayer = { ...cameraBase, transform: { ...cameraBase.transform, position: motionVector([16, 16, -32]) } };
const frame = (layers: readonly MotionLayer[], depthOfFieldSamples = 16) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers, depthOfFieldSamples }] }).evaluate({ compositionId: 'main', time: 0 });
const pixel = (surface: Awaited<ReturnType<typeof renderMotionCompositionFrame>>, x: number, y = 16) => [...surface.pixels.subarray((y * surface.width + x) * 4, (y * surface.width + x) * 4 + 4)];

test('thin-lens samples converge exactly at the focus plane and one-sample quality is the declared pinhole preview', async () => {
	const input = frame([card, camera]); const focused = await renderMotionCompositionFrame(input, { rasterizer });
	const pinhole = await renderMotionCompositionFrame(input, { rasterizer, depthOfFieldSamples: 1 });
	assert.deepEqual(focused.pixels, pinhole.pixels); assert.equal(focused.consumedOperationIds.length, input.requiredOperationIds.length);
});

test('out-of-focus translucent depth rays spread coverage without blurring 2D overlays or remembering prior seeks', async () => {
	const far = { ...card, transform: { ...card.transform, position: motionVector([12, 12, 32]) } }; const input = frame([far, camera]);
	const result = await renderMotionCompositionFrame(input, { rasterizer }); const pinhole = await renderMotionCompositionFrame(input, { rasterizer, depthOfFieldSamples: 1 });
	assert.equal(pixel(pinhole, 12)[3], 0); assert.ok(pixel(result, 12)[3]! > 0); assert.ok(pixel(result, 12)[3]! < 1);
	for (let i = 0; i < result.pixels.length; i += 4) assert.equal(result.pixels[i], result.pixels[i + 3], 'premultiplied white edges retain coverage');
	const overlay = { ...card, id: 'overlay', is3D: false, transform: { ...card.transform, position: motionVector([0, 0, 0]) } };
	const withOverlay = await renderMotionCompositionFrame(frame([overlay, far, camera]), { rasterizer }); assert.deepEqual(pixel(withOverlay, 4, 4), [1, 1, 1, 1]);
	await renderMotionCompositionFrame(frame([card, camera]), { rasterizer }); assert.deepEqual((await renderMotionCompositionFrame(input, { rasterizer })).pixels, result.pixels);
});

test('lens quality and combined ray work are admitted before source or target acquisition', async () => {
	let allocations = 0; const compositor = { supportsReplacement: true, retainedSurfaceCount: 1 as const, begin() { allocations++; throw new Error('Must not allocate.'); } };
	const input = frame([card, camera], 4);
	await assert.rejects(renderMotionCompositionFrame(input, { rasterizer, compositor, depthOfFieldSamples: 5 }), /quality|samples/u);
	await assert.rejects(renderMotionCompositionFrame(input, { rasterizer, compositor, depthOfFieldSamples: 0 }), /quality|samples/u);
	await assert.rejects(renderMotionCompositionFrame({ ...frame([card, camera]), width: 4096, height: 4096 }, { rasterizer, compositor }), /ray.*budget/u);
	assert.equal(allocations, 0);
});
