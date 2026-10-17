/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';

const kit = await CanvasKitInit();
const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const project = createMotionscaperProject({ id: 'depth', title: 'Depth', compositionId: 'main', width: 32, height: 32 });
const solid = (id: string, color: readonly [number, number, number, number]): MotionLayer => createMotionLayer({ id, name: id, durationFrames: 300,
	content: { kind: 'solid', size: motionVector([32, 32]), color: motionColor(color) } });
const plane = (layer: MotionLayer, z = 0, rotationY = 0): MotionLayer => ({ ...layer, is3D: true, transform: { ...layer.transform,
	anchor: motionVector([16, 16, 0]), position: motionVector([16, 16, z]), rotation: motionVector([0, rotationY, 0]) } });
const camera = (): MotionLayer => {
	const layer = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'orthographic', zoom: motionScalar(32),
		near: 1, far: 1000, focusDistance: motionScalar(32), aperture: motionScalar(0) } });
	return { ...layer, transform: { ...layer.transform, position: motionVector([16, 16, -100]) } };
};
const frame = (layers: readonly MotionLayer[]) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time: 0 });
const pixel = (surface: Awaited<ReturnType<typeof renderMotionCompositionFrame>>, x: number, y = 16) => [...surface.pixels.subarray((y * surface.width + x) * 4, (y * surface.width + x) * 4 + 4)];
const near = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-6, `${actual} differs from ${expected}`));

test('3D z=0 planes retain the 2D pixel grid, local masks, expanded effects and consumption ledger', async () => {
	const red: MotionLayer = { ...solid('red', [1, 0, 0, 0.5]), masks: [{ id: 'half', path: motionRectanglePath({ x: 0, y: 0, width: 16, height: 32 }), operation: 'add',
		inverted: false, opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0) }], effects: [{ id: 'outline', type: 'outline', enabled: true,
		parameters: [{ id: 'width', value: motionScalar(2) }] }] };
	const reference = await renderMotionCompositionFrame(frame([red]), { rasterizer }); const input = frame([plane(red)]);
	const result = await renderMotionCompositionFrame(input, { rasterizer });
	assert.deepEqual(result.pixels, reference.pixels); assert.deepEqual(new Set(result.consumedOperationIds), new Set(input.requiredOperationIds));
});

test('intersecting translucent planes sort per pixel and equal-depth ties preserve authored order', async () => {
	const red = plane(solid('red', [1, 0, 0, 0.5]), 0, 60); const green = plane(solid('green', [0, 1, 0, 0.5]), 0, -60);
	const input = frame([red, green, camera()]); const result = await renderMotionCompositionFrame(input, { rasterizer });
	near(pixel(result, 10), [0.25, 0.5, 0, 0.75]); near(pixel(result, 22), [0.5, 0.25, 0, 0.75]);
	const tie = await renderMotionCompositionFrame(frame([plane(solid('red', [1, 0, 0, 0.5])), plane(solid('green', [0, 1, 0, 0.5]))]), { rasterizer });
	near(pixel(tie, 16), [0.5, 0.25, 0, 0.75]);
});

test('2D layers separate depth groups and blend modes see the actual backdrop', async () => {
	const red = plane(solid('red', [1, 0, 0, 0.5]), 100); const green = plane(solid('green', [0, 1, 0, 1]), 0); const blue = solid('blue', [0, 0, 1, 1]);
	const result = await renderMotionCompositionFrame(frame([red, blue, green, camera()]), { rasterizer }); near(pixel(result, 16), [0.5, 0, 0.5, 1]);
	const multiply = await renderMotionCompositionFrame(frame([{ ...plane(solid('red', [1, 0, 0, 0.5])), blendMode: 'multiply' }, blue]), { rasterizer });
	near(pixel(multiply, 16), [0, 0, 0.5, 1]);
});

test('projected mattes use composition coordinates without painting and preserve matte opacity', async () => {
	const red = { ...plane(solid('red', [1, 0, 0, 0.5])), matte: { layerId: 'matte', mode: 'alpha' as const } };
	const matte = plane(solid('matte', [0, 1, 0, 0.5]), 32); const input = frame([red, { ...matte, transform: { ...matte.transform, opacity: motionScalar(0.5) } }]);
	const result = await renderMotionCompositionFrame(input, { rasterizer }); near(pixel(result, 16), [0.125, 0, 0, 0.125]); near(pixel(result, 3), [0, 0, 0, 0]);
	assert.equal(result.consumedOperationIds.length, input.requiredOperationIds.length);
});

test('3D precompositions retain isolated child output and parent transforms', async () => {
	const parent = createMotionLayer({ id: 'parent', name: 'Parent', durationFrames: 300, content: { kind: 'null' } });
	const child = { ...project.compositions[0]!, id: 'child', layers: [solid('child-red', [1, 0, 0, 0.5]), solid('child-green', [0, 1, 0, 0.5])] };
	const precomp = plane(createMotionLayer({ id: 'precomp', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }));
	const evaluator = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...precomp, parentId: 'parent' },
		{ ...parent, is3D: true, transform: { ...parent.transform, position: motionVector([0, 0, 32]) } }] }, child] });
	const input = evaluator.evaluate({ compositionId: 'main', time: 0 }); const result = await renderMotionCompositionFrame(input, { rasterizer });
	near(pixel(result, 16), [0.5, 0.25, 0, 0.75]); near(pixel(result, 3), [0, 0, 0, 0]); assert.equal(result.consumedOperationIds.length, input.requiredOperationIds.length);
	const inactiveEvaluator = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...precomp, sourceStart: { num: 11, den: 1 } }] }, child] });
	const inactiveInput = inactiveEvaluator.evaluate({ compositionId: 'main', time: 0 }); const inactive = await renderMotionCompositionFrame(inactiveInput, { rasterizer });
	near(pixel(inactive, 16), [0, 0, 0, 0]); assert.equal(inactive.consumedOperationIds.length, inactiveInput.requiredOperationIds.length);
});

test('projected matte chains apply each coverage once and inactive inverted mattes remain full', async () => {
	const red = { ...plane(solid('red', [1, 0, 0, 0.5])), matte: { layerId: 'middle', mode: 'alpha' as const } };
	const middle = { ...plane(solid('middle', [0, 1, 0, 0.5])), matte: { layerId: 'leaf', mode: 'alpha' as const } };
	const leaf = plane(solid('leaf', [1, 1, 1, 0.5])); const input = frame([red, middle, leaf]);
	const result = await renderMotionCompositionFrame(input, { rasterizer }); near(pixel(result, 16), [0.125, 0, 0, 0.125]);
	assert.equal(result.consumedOperationIds.length, input.requiredOperationIds.length);
	const inverted = await renderMotionCompositionFrame(frame([{ ...red, matte: { layerId: 'middle', mode: 'alpha-inverted' } }, { ...middle, matte: null, enabled: false }]), { rasterizer });
	near(pixel(inverted, 16), [0.5, 0, 0, 0.5]);
});

test('3D capability, singular transforms, excessive ray work and memory refuse before target/source acquisition', async () => {
	let allocations = 0; const compositor = { supportsReplacement: true, retainedSurfaceCount: 1 as const, begin() { allocations++; throw new Error('Must not allocate.'); } };
	const red = plane(solid('red', [1, 0, 0, 1]));
	await assert.rejects(renderMotionCompositionFrame(frame([red]), { rasterizer: { rasterize: rasterizer.rasterize }, compositor }), /local.*3D|3D.*local/u);
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...red, transform: { ...red.transform, scale: motionVector([0, 1, 1]) } }]), { rasterizer, compositor }), /singular/u);
	await assert.rejects(renderMotionCompositionFrame(frame([red]), { rasterizer, compositor, maximumWorkingBytes: 128 }), /budget/u);
	const oversized = { ...frame([red]), width: 4096, height: 4096, layers: Array.from({ length: 5 }, () => frame([red]).layers[0]!) };
	await assert.rejects(renderMotionCompositionFrame(oversized, { rasterizer, compositor }), /ray.*budget/u); assert.equal(allocations, 0);
});

test('depth compositing cooperatively cancels without returning a partial frame', async () => {
	const input = { ...frame([plane(solid('red', [1, 0, 0, 1]))]), width: 256, height: 256 };
	const controller = new AbortController(); const pending = renderMotionCompositionFrame(input, { rasterizer, signal: controller.signal });
	setTimeout(() => controller.abort(), 0); await assert.rejects(pending, { name: 'AbortError' });
});
