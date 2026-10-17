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
import type { MotionCompositionFrame } from '../src/common/editor/motion-composition-evaluation.ts';

const kit = await CanvasKitInit();
const project = createMotionscaperProject({ id: 'matte', compositionId: 'main', title: 'Mattes', width: 32, height: 32 });
const rasterizer = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const solid = (id: string, color: readonly [number, number, number, number]): MotionLayer => createMotionLayer({ id, name: id, durationFrames: 300,
	content: { kind: 'solid', color: motionColor(color), size: motionVector([16, 16]) } });
const frame = (layers: readonly MotionLayer[], time: number = 0): MotionCompositionFrame => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time });
const alpha = (result: Awaited<ReturnType<typeof renderMotionCompositionFrame>>, x = 8, y = 8) => result.pixels[(y * result.width + x) * 4 + 3]!;
const red = solid('red', [1, 0, 0, 0.5]); const green = solid('green', [0, 1, 0, 0.5]);

test('alpha mattes consume source masks/effects/transform/opacity but do not paint the matte layer into the composition', async () => {
	const input = frame([{ ...red, transform: { ...red.transform, opacity: motionScalar(0.5) }, matte: { layerId: 'green', mode: 'alpha' } },
		{ ...green, transform: { ...green.transform, opacity: motionScalar(0.5), position: motionVector([4, 0, 0]) },
			masks: [{ id: 'half', path: motionRectanglePath({ x: 0, y: 0, width: 8, height: 16 }), operation: 'add', inverted: false,
				opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0) }],
			effects: [{ id: 'color', type: 'color-adjust', enabled: true, parameters: [{ id: 'brightness', value: motionScalar(-0.1) }] }] }]);
	const result = await renderMotionCompositionFrame(input, { rasterizer: rasterizer() });
	assert.equal(alpha(result), 0.0625); assert.equal(alpha(result, 2), 0);
	assert.equal(alpha(result, 14), 0, 'matte masks are applied before its world transform');
	assert.equal(alpha(result, 18), 0, 'a referenced matte remains hidden outside its consumer');
	assert.deepEqual([...result.pixels.subarray((8 * 32 + 8) * 4, (8 * 32 + 8) * 4 + 4)], [0.0625, 0, 0, 0.0625]);
	assert.deepEqual(new Set(result.consumedOperationIds), new Set(input.requiredOperationIds));
});

test('luma mattes use associated linear Rec.709 luminance and inversion applies after matte opacity', async () => {
	const matte = { ...green, transform: { ...green.transform, opacity: motionScalar(0.5) } };
	for (const mode of ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'] as const) {
		const result = await renderMotionCompositionFrame(frame([{ ...red, matte: { layerId: 'green', mode } }, matte]), { rasterizer: rasterizer() });
		const coverage = mode.startsWith('alpha') ? 0.25 : 0.7152 * 0.25;
		const expected = 0.5 * (mode.endsWith('inverted') ? 1 - coverage : coverage);
		assert.ok(Math.abs(alpha(result) - expected) < 1e-6);
	}
});

test('an inactive matte is transparent and inverted coverage remains full without inventing a missing-layer error', async () => {
	for (const mode of ['alpha', 'alpha-inverted'] as const) {
		const result = await renderMotionCompositionFrame(frame([{ ...red, matte: { layerId: 'green', mode } }, { ...green, enabled: false }]), { rasterizer: rasterizer() });
		assert.equal(alpha(result), mode === 'alpha' ? 0 : 0.5);
	}
	assert.throws(() => frame([{ ...red, matte: { layerId: 'missing', mode: 'alpha' } }]), /missing parent\/matte/u);
});

test('matte chains reuse each source once across multiple consumers and consume every operation once', async () => {
	const second = solid('second', [0, 0, 1, 0.5]); const leaf = solid('leaf', [1, 1, 1, 0.5]);
	const input = frame([{ ...red, matte: { layerId: 'green', mode: 'alpha' } }, { ...second, matte: { layerId: 'green', mode: 'alpha' } },
		{ ...green, matte: { layerId: 'leaf', mode: 'alpha' } }, leaf]);
	const raster = rasterizer(); const calls = new Map<string, number>();
	const result = await renderMotionCompositionFrame(input, { rasterizer: { ...raster, async rasterize(layer, target, signal) {
		calls.set(layer.state.id, (calls.get(layer.state.id) ?? 0) + 1); return raster.rasterize(layer, target, signal);
	} } });
	assert.equal(calls.get('green'), 1); assert.equal(calls.get('leaf'), 1); assert.equal(alpha(result), 0.234375);
	assert.equal(result.consumedOperationIds.length, input.requiredOperationIds.length);
});

test('cyclic or non-pixel matte dependencies and retained matte surfaces refuse before target allocation', async () => {
	assert.throws(() => frame([{ ...red, matte: { layerId: 'green', mode: 'alpha' } }, { ...green, matte: { layerId: 'red', mode: 'alpha' } }]), /cycle/u);
	let allocations = 0; const compositor = { retainedSurfaceCount: 1 as const, begin() { allocations++; throw new Error('Must not allocate.'); } };
	const nonPixel = createMotionLayer({ id: 'null', name: 'Null', durationFrames: 300, content: { kind: 'null' } });
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...red, matte: { layerId: 'null', mode: 'alpha' } }, nonPixel]), { rasterizer: rasterizer(), compositor }), /non-pixel|matte source/u);
	const valid = frame([{ ...red, matte: { layerId: 'green', mode: 'alpha' } }, green]);
	const cyclic = { ...valid, layers: valid.layers.map((layer) => layer.state.id === 'green' ? { ...layer, state: { ...layer.state, matte: { layerId: 'red', mode: 'alpha' as const } } } : layer) };
	await assert.rejects(renderMotionCompositionFrame(cyclic, { rasterizer: rasterizer(), compositor }), /cycle/u);
	await renderMotionCompositionFrame(frame([red, green]), { rasterizer: rasterizer(), maximumWorkingBytes: 65536 });
	await assert.rejects(renderMotionCompositionFrame(valid, { rasterizer: rasterizer(), compositor, maximumWorkingBytes: 65536 }), /budget/u);
	assert.equal(allocations, 0);
});
