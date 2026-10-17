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
import type { MotionMask } from '../src/common/editor/motion-composition.ts';
import type { MotionSurface } from '../src/common/editor/motion-surface.ts';
import { applyMotionMasks } from '../src/common/editor/motion-mask-rendering.ts';

const kit = await CanvasKitInit();
const project = createMotionscaperProject({ id: 'mask', compositionId: 'main', title: 'Masks', width: 32, height: 32 });
const rasterizer = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const mask = (options: Partial<MotionMask> = {}): MotionMask => ({ id: 'mask', path: motionRectanglePath({ x: 6, y: 0, width: 4, height: 16 }),
	opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add', ...options });
const evaluate = (masks: readonly MotionMask[], position: readonly [number, number, number] = [0, 0, 0], time: number = 0) => {
	const layer = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([16, 16]) } });
	return compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...layer, masks, transform: { ...layer.transform, position: motionVector(position) } }] }] }).evaluate({ compositionId: 'main', time });
};
const alpha = (surface: MotionSurface, x: number, y = 8) => surface.pixels[(y * surface.width + x) * 4 + 3]!;
const render = (masks: readonly MotionMask[], position?: readonly [number, number, number]) => renderMotionCompositionFrame(evaluate(masks, position), { rasterizer: rasterizer() });

test('masks apply premultiplied coverage before world transform and consume their declared operations', async () => {
	const frame = evaluate([mask({ opacity: motionScalar(0.5) })], [5, 3, 0]);
	const result = await renderMotionCompositionFrame(frame, { rasterizer: rasterizer() });
	assert.equal(alpha(result, 11, 11), 0.25); assert.equal(alpha(result, 10, 11), 0);
	assert.deepEqual([...result.pixels.subarray((11 * 32 + 11) * 4, (11 * 32 + 11) * 4 + 4)], [0.25, 0, 0, 0.25]);
	assert.deepEqual(new Set(result.consumedOperationIds), new Set(frame.requiredOperationIds));
});

test('mask inversion, additive union, subtraction, intersection and difference retain their authored order', async () => {
	assert.equal(alpha(await render([mask({ inverted: true })]), 7), 0);
	assert.equal(alpha(await render([mask({ operation: 'subtract' })]), 4), 0.5);
	assert.equal(alpha(await render([mask({ operation: 'intersect' })]), 7), 0.5);
	const first = mask({ opacity: motionScalar(0.5) }); const second = mask({ id: 'second', opacity: motionScalar(0.5) });
	assert.equal(alpha(await render([first, second]), 7), 0.375);
	assert.equal(alpha(await render([first, { ...second, operation: 'subtract' }]), 7), 0.125);
	assert.equal(alpha(await render([first, { ...second, operation: 'difference' }]), 7), 0.25);
});

test('mask expansion and contraction precede anisotropic Gaussian feathering in local pixels', async () => {
	const expanded = await render([mask({ expansion: motionScalar(1) })]);
	assert.ok(alpha(expanded, 5) > 0.49); assert.equal(alpha(expanded, 4), 0);
	const contracted = await render([mask({ expansion: motionScalar(-1) })]);
	assert.equal(alpha(contracted, 6), 0); assert.ok(alpha(contracted, 7) > 0.49);
	const feathered = await render([mask({ feather: motionVector([1.5, 0]) })]);
	assert.ok(alpha(feathered, 5) > 0.12 && alpha(feathered, 5) < 0.24);
	assert.ok(alpha(feathered, 6) > alpha(feathered, 5)); assert.ok(alpha(feathered, 2) < 0.025);
	assert.equal(alpha(feathered, 7, 16), 0, 'a zero vertical sigma does not blur below the path');
});

test('feathering includes mask geometry outside source bounds and does not invent edge attenuation', async () => {
	const full = mask({ path: motionRectanglePath({ x: -100, y: -100, width: 200, height: 200 }), feather: motionVector([2, 2]) });
	const result = await render([full]); assert.ok(alpha(result, 0, 0) > 0.4999); assert.ok(alpha(result, 15, 15) > 0.4999);
});

test('mask parameter and working-memory refusal precede any raster allocation', async () => {
	let calls = 0; const raster = rasterizer();
	const observed = { ...raster, async rasterize(...args: Parameters<typeof raster.rasterize>) { calls++; return raster.rasterize(...args); } };
	await assert.rejects(renderMotionCompositionFrame(evaluate([mask({ feather: motionVector([-1, 0]) })]), { rasterizer: observed }), /feather/u);
	await assert.rejects(renderMotionCompositionFrame(evaluate([mask({ feather: motionVector([128, 128]) })]), { rasterizer: observed, maximumWorkingBytes: 1024 }), /budget/u);
	assert.equal(calls, 0);
});

test('mask animation uses the evaluator time and mask processing preserves borrowed local source pixels', async () => {
	const animated = mask({ opacity: { ...motionScalar(0), curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: 30, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] } } });
	const frame = evaluate([animated], [0, 0, 0], 0.5); const layer = frame.layers[0]!;
	const raster = rasterizer(); const original = await raster.rasterizeSource(layer, frame); const saved = original.surface.pixels.slice();
	const masked = await applyMotionMasks(original, layer.state.masks, raster);
	assert.equal(alpha(masked.surface, 7), 0.25); assert.deepEqual(original.surface.pixels, saved);
	assert.notEqual(masked.surface.pixels, original.surface.pixels);
});

test('precomposition masks operate on the isolated child canvas before parent transformation', async () => {
	const parent = createMotionLayer({ id: 'pre', name: 'Child', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } });
	const frame = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...parent, masks: [mask()],
		transform: { ...parent.transform, position: motionVector([5, 3, 0]) } }] }, { ...project.compositions[0]!, id: 'child', width: 16, height: 16, background: [0, 1, 0, 1] }] }).evaluate({ compositionId: 'main', time: 0 });
	const result = await renderMotionCompositionFrame(frame, { rasterizer: rasterizer() });
	assert.deepEqual([...result.pixels.subarray((11 * 32 + 11) * 4, (11 * 32 + 11) * 4 + 4)], [0, 1, 0, 1]);
	assert.equal(alpha(result, 10, 11), 0); assert.equal(alpha(result, 15, 11), 0);
	assert.deepEqual(new Set(result.consumedOperationIds), new Set(frame.requiredOperationIds));
});

test('mask admission refuses unavailable local renderers and incomplete coverage, and observes cancellation', async () => {
	const frame = evaluate([mask()]); const raster = rasterizer(); let allocations = 0;
	await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer: { async rasterize() { allocations++; throw new Error('Must not allocate.'); } } }), /local-source renderer/u);
	assert.equal(allocations, 0);
	const local = await raster.rasterizeSource(frame.layers[0]!, frame);
	await assert.rejects(applyMotionMasks(local, frame.layers[0]!.state.masks, { estimateMaskWorkingBytes: () => 1024, async rasterizeMask() { /* Leaves the caller-owned scratch untouched. */ } }), /incomplete coverage/u);
	const controller = new AbortController(); let calls = 0;
	await assert.rejects(applyMotionMasks(local, [...frame.layers[0]!.state.masks, { ...frame.layers[0]!.state.masks[0]!, id: 'second' }], {
		estimateMaskWorkingBytes: () => 1024, async rasterizeMask(_mask, target) { calls++; target.coverage.fill(1); controller.abort(); },
	}, controller.signal), { name: 'AbortError' });
	assert.equal(calls, 1);
});
