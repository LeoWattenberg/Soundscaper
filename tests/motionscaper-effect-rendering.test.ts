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
import type { MotionEffect, MotionMask } from '../src/common/editor/motion-composition.ts';
import { validateMotionSurface, type MotionSurface } from '../src/common/editor/motion-surface.ts';
import { applyMotionEffects } from '../src/common/editor/motion-effect-rendering.ts';

const kit = await CanvasKitInit();
const project = createMotionscaperProject({ id: 'effect', compositionId: 'main', title: 'Effects', width: 32, height: 32 });
const effect = (type: string, params: Readonly<Record<string, number>> = {}, id: string = type): MotionEffect => ({ id, type, enabled: true,
	parameters: Object.entries(params).map(([id, value]) => ({ id, value: motionScalar(value) })) });
const rasterizer = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const frame = (effects: readonly MotionEffect[], options: Readonly<{ color?: readonly [number, number, number, number]; masks?: readonly MotionMask[] }> = {}) => {
	const layer = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor(options.color ?? [0.5, 0, 0, 0.5]), size: motionVector([8, 8]) } });
	return compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...layer, effects, masks: options.masks ?? [],
		transform: { ...layer.transform, position: motionVector([8, 8, 0]) } }] }] }).evaluate({ compositionId: 'main', time: 0 });
};
const pixel = (s: MotionSurface, x: number, y = 11) => [...s.pixels.subarray((y * s.width + x) * 4, (y * s.width + x) * 4 + 4)];
const render = (effects: readonly MotionEffect[], options?: Parameters<typeof frame>[1]) => renderMotionCompositionFrame(frame(effects, options), { rasterizer: rasterizer() });

test('ordered registered color effects operate in local linear light and preserve premultiplied coverage', async () => {
	const input = frame([effect('color-adjust', { brightness: 0.1 }), effect('color-adjust', { contrast: 0.5 }, 'contrast')]);
	const result = await renderMotionCompositionFrame(input, { rasterizer: rasterizer() });
	assert.ok(Math.abs(pixel(result, 11)[0]! - 0.275) < 1e-6); assert.equal(pixel(result, 11)[3], 0.5);
	const reverse = await render([effect('color-adjust', { contrast: 0.5 }), effect('color-adjust', { brightness: 0.1 }, 'bright')]);
	assert.ok(Math.abs(pixel(reverse, 11)[0]! - 0.3) < 1e-6);
	assert.deepEqual(new Set(result.consumedOperationIds), new Set(input.requiredOperationIds)); validateMotionSurface(result);
});

test('Gaussian blur follows masks and spreads coverage beyond intrinsic source bounds before transform', async () => {
	const mask: MotionMask = { id: 'half', path: motionRectanglePath({ x: 0, y: 0, width: 4, height: 8 }), opacity: motionScalar(1),
		feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' };
	const result = await render([effect('gaussian-blur', { sigma: 1 })], { masks: [mask] });
	assert.ok(pixel(result, 7)[3]! > 0.02); assert.ok(pixel(result, 12)[3]! > 0.02); assert.ok(pixel(result, 15)[3]! < 0.005);
	for (let i = 0; i < result.pixels.length; i += 4) assert.ok(Math.abs(result.pixels[i]! - result.pixels[i + 3]! * 0.5) < 1e-6);
	validateMotionSurface(result);
});

test('registered chroma/luma keying and spill suppression preserve fractional source alpha', async () => {
	assert.deepEqual(pixel(await render([effect('chroma-key')], { color: [0, 1, 0, 0.5] }), 11), [0, 0, 0, 0]);
	assert.equal(pixel(await render([effect('chroma-key')]), 11)[3], 0.5);
	assert.equal(pixel(await render([effect('luma-key', { cutoff: 0.2, softness: 0 })], { color: [0.1, 0.1, 0.1, 0.5] }), 11)[3], 0);
	assert.equal(pixel(await render([effect('luma-key', { mode: 1, cutoff: 0.8, softness: 0 })], { color: [1, 1, 1, 0.5] }), 11)[3], 0);
	assert.deepEqual(pixel(await render([effect('spill-suppression', { strength: 1 })], { color: [0.25, 1, 0.25, 0.5] }), 11), [0.125, 0.125, 0.125, 0.5]);
});

test('shadow, outline and glow retain expanded local origins and source-over alpha', async () => {
	const shadow = await render([effect('drop-shadow', { offsetX: 4, offsetY: 0, sigma: 0, opacity: 1 })]);
	assert.deepEqual(pixel(shadow, 18), [0, 0, 0, 0.5]); assert.deepEqual(pixel(shadow, 13), [0.25, 0, 0, 0.75]);
	const outline = await render([effect('outline', { width: 2, color: 0xffffff, opacity: 1 })]);
	assert.deepEqual(pixel(outline, 6), [0.5, 0.5, 0.5, 0.5]); assert.equal(pixel(outline, 5)[3], 0);
	const glow = await render([effect('glow', { threshold: 0, sigma: 1, intensity: 1 })], { color: [1, 1, 1, 1] });
	assert.ok(pixel(glow, 7)[3]! > 0.05); assert.deepEqual(pixel(glow, 11), [1, 1, 1, 1]);
	for (const surface of [shadow, outline, glow]) validateMotionSurface(surface);
});

test('pixelate averages premultiplied blocks and RGB split exposes bounded shifted channel coverage', async () => {
	const mask: MotionMask = { id: 'half', path: motionRectanglePath({ x: 0, y: 0, width: 2, height: 8 }), opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' };
	const result = await render([effect('pixelate', { blockSize: 4 })], { masks: [mask] });
	assert.deepEqual(pixel(result, 11), [0.125, 0, 0, 0.25]); assert.equal(pixel(result, 12)[3], 0);
	const split = await render([effect('rgb-split', { offsetX: 2, offsetY: 0 })]);
	assert.deepEqual(pixel(split, 16), [0.25, 0, 0, 0.5]); assert.equal(pixel(split, 18)[3], 0);
});

test('vignette and sharpen preserve alpha while handling transparent neighboring pixels', async () => {
	const vignette = await render([effect('vignette', { amount: 1 })]); assert.equal(pixel(vignette, 8, 8)[3], 0.5);
	assert.ok(pixel(vignette, 8, 8)[0]! < pixel(vignette, 11, 11)[0]!);
	const sharp = await render([effect('sharpen')]); assert.equal(pixel(sharp, 8, 8)[3], 0.5); validateMotionSurface(sharp);
});

test('unavailable effects and invalid animated registry parameters refuse before allocation, while bypassed intent is retained', async () => {
	let allocations = 0; const raster = rasterizer(); const observed = { ...raster, async rasterize(...args: Parameters<typeof raster.rasterize>) { allocations++; return raster.rasterize(...args); } };
	await assert.rejects(renderMotionCompositionFrame(frame([effect('unavailable-plugin')]), { rasterizer: observed }), /unavailable|unsupported/iu);
	await assert.rejects(renderMotionCompositionFrame(frame([effect('gaussian-blur', { sigma: 21 })]), { rasterizer: observed }), /sigma/u);
	await assert.rejects(renderMotionCompositionFrame(frame([effect('color-adjust', { arbitrary: 1 })]), { rasterizer: observed }), /arbitrary/u);
	assert.equal(allocations, 0);
	const result = await render([{ ...effect('unavailable-plugin'), enabled: false }]); assert.deepEqual(pixel(result, 11), [0.25, 0, 0, 0.5]);
});

test('zero-strength registered filters preserve input coverage including source edges', async () => {
	for (const noop of [effect('gaussian-blur', { sigma: 0 }), effect('outline', { width: 0 }), effect('drop-shadow', { opacity: 0 }),
		effect('glow', { intensity: 0 }), effect('vignette', { amount: 0 }), effect('rgb-split', { offsetX: 0, offsetY: 0 }), effect('sharpen', { amount: 0 })]) {
		const result = await render([noop]); assert.deepEqual(pixel(result, 8, 8), [0.25, 0, 0, 0.5]); assert.equal(pixel(result, 7, 8)[3], 0);
	}
});

test('effect stacks preserve borrowed source pixels and refuse cumulative local surface budgets before allocation', async () => {
	const evaluated = frame([effect('gaussian-blur', { sigma: 1 }), effect('drop-shadow')]); const raster = rasterizer();
	const local = await raster.rasterizeSource(evaluated.layers[0]!, evaluated); const saved = local.surface.pixels.slice();
	await applyMotionEffects(local, evaluated.layers[0]!.state.effects, raster); assert.deepEqual(local.surface.pixels, saved);
	let allocations = 0;
	await assert.rejects(renderMotionCompositionFrame(evaluated, { rasterizer: raster, maximumWorkingBytes: 1024, compositor: {
		begin() { allocations++; throw new Error('Must not allocate.'); },
	} }), /budget/u); assert.equal(allocations, 0);
	const large = frame(Array.from({ length: 24 }, (_, i) => effect('gaussian-blur', { sigma: 20 }, `blur-${i}`)));
	await assert.rejects(renderMotionCompositionFrame(large, { rasterizer: raster }), /budget|megapixel/u);
});
