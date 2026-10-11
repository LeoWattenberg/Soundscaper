/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionCpuCompositor, renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';

const kit = await CanvasKitInit(); const project = createMotionscaperProject({ id: 'adjustment', title: 'Adjustment', compositionId: 'main', width: 32, height: 32 });
const rasterizer = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const red = createMotionLayer({ id: 'red', name: 'Red', durationFrames: 300, content: { kind: 'solid', size: motionVector([16, 16]), color: motionColor([1, 0, 0, 0.5]) } });
const blue = createMotionLayer({ id: 'blue', name: 'Blue', durationFrames: 300, content: { kind: 'solid', size: motionVector([16, 16]), color: motionColor([0, 0, 1, 1]) } });
const adjustmentBase = createMotionLayer({ id: 'adjustment', name: 'Adjust', durationFrames: 300, content: { kind: 'adjustment', targetLayerIds: ['red', 'blue'] } });
if (adjustmentBase.kind !== 'adjustment') throw new Error('Unexpected adjustment fixture.');
const adjustment = { ...adjustmentBase,
	effects: [{ id: 'brighten', type: 'color-adjust', enabled: true, parameters: [{ id: 'brightness', value: motionScalar(0.1) }] }] };
const evaluate = (layers: readonly MotionLayer[]) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time: 0 });
const pixel = (surface: Awaited<ReturnType<typeof renderMotionCompositionFrame>>, x: number = 8) => [...surface.pixels.subarray((8 * 32 + x) * 4, (8 * 32 + x) * 4 + 4)];
const near = (actual: readonly number[], expected: readonly number[]) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) < 1e-6, `${actual.join(',')} versus ${expected.join(',')}`));

test('adjustments filter the already-composited backdrop once and consume their ordered ledger', async () => {
	const frame = evaluate([adjustment, red, blue]); const result = await renderMotionCompositionFrame(frame, { rasterizer: rasterizer() });
	near(pixel(result), [0.6, 0.1, 0.6, 1]); assert.deepEqual(new Set(result.consumedOperationIds), new Set(frame.requiredOperationIds));
});

test('adjustment masks, world transform and opacity weight effect replacement without cutting the original backdrop', async () => {
	const masked = { ...adjustment, masks: [{ id: 'region', path: motionRectanglePath({ x: 0, y: 0, width: 8, height: 32 }), opacity: motionScalar(1),
		feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' as const }],
		transform: { ...adjustment.transform, position: motionVector([4, 0, 0]), opacity: motionScalar(0.5) } };
	const result = await renderMotionCompositionFrame(evaluate([masked, red, blue]), { rasterizer: rasterizer() });
	near(pixel(result, 8), [0.55, 0.05, 0.55, 1]); near(pixel(result, 2), [0.5, 0, 0.5, 1]); near(pixel(result, 14), [0.5, 0, 0.5, 1]);
});

test('adjustment matte coverage includes source opacity and hidden matte pixels do not enter the backdrop', async () => {
	const matte = createMotionLayer({ id: 'matte', name: 'Matte', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 1, 1, 0.5]), size: motionVector([16, 16]) } });
	const result = await renderMotionCompositionFrame(evaluate([{ ...adjustment, matte: { layerId: 'matte', mode: 'alpha' }, transform: { ...adjustment.transform, opacity: motionScalar(0.5) } }, red, blue,
		{ ...matte, transform: { ...matte.transform, opacity: motionScalar(0.5) } }]), { rasterizer: rasterizer() });
	near(pixel(result), [0.5125, 0.0125, 0.5125, 1]);
});

test('an adjustment with no enabled targets or effects is a retained no-op', async () => {
	for (const own of [{ ...adjustment, targetLayerIds: [] }, { ...adjustment, effects: [] }]) {
		const result = await renderMotionCompositionFrame(evaluate([own, red, blue]), { rasterizer: rasterizer() }); near(pixel(result), [0.5, 0, 0.5, 1]);
	}
});

test('partial or above-layer adjustment targets refuse with isolation guidance before allocation', async () => {
	let allocations = 0; const compositor = { supportsReplacement: true, begin() { allocations++; throw new Error('Must not allocate.'); } };
	await assert.rejects(renderMotionCompositionFrame(evaluate([{ ...adjustment, targetLayerIds: ['red'] }, red, blue]), { rasterizer: rasterizer(), compositor }), /precompose|below|target/iu);
	await assert.rejects(renderMotionCompositionFrame(evaluate([red, adjustment, blue]), { rasterizer: rasterizer(), compositor }), /below|target/iu);
	await assert.rejects(renderMotionCompositionFrame(evaluate([adjustment, red, blue]), { rasterizer: rasterizer(), maximumWorkingBytes: 1024, compositor }), /budget/u);
	assert.equal(allocations, 0);
});

test('adjustments preserve surrounding layer order and effect-produced alpha instead of source-over duplicating the backdrop', async () => {
	const green = { ...blue, id: 'green', name: 'Green', color: motionColor([0, 1, 0, 0.5]) };
	const result = await renderMotionCompositionFrame(evaluate([green, adjustment, red, blue]), { rasterizer: rasterizer() });
	near(pixel(result), [0.3, 0.55, 0.3, 1]);
	const keyed = { ...adjustment, targetLayerIds: ['blue'], transform: { ...adjustment.transform, opacity: motionScalar(0.5) },
		effects: [{ id: 'key', type: 'luma-key', enabled: true, parameters: [{ id: 'cutoff', value: motionScalar(0.5) }] }] };
	const keyedResult = await renderMotionCompositionFrame(evaluate([keyed, blue]), { rasterizer: rasterizer() });
	near(pixel(keyedResult), [0, 0, 0.5, 0.5]);
});

test('adjustment cancellation never publishes a replacement and always disposes the target', async () => {
	const controller = new AbortController(); let replacements = 0; let disposals = 0;
	const own = rasterizer(); const effect = own.rasterizeEffect.bind(own);
	const compositor = { supportsReplacement: true, retainedSurfaceCount: 1 as const, begin(width: number, height: number, background: Parameters<typeof motionCpuCompositor.begin>[2]) {
		const target = motionCpuCompositor.begin(width, height, background);
		return { ...target, replace() { replacements++; }, dispose() { disposals++; target.dispose(); } };
	} };
	await assert.rejects(renderMotionCompositionFrame(evaluate([adjustment, red, blue]), { compositor, signal: controller.signal,
		rasterizer: { ...own, async rasterizeEffect(...args) { const result = await effect(...args); controller.abort(); return result; } } }), /abort/iu);
	assert.equal(replacements, 0); assert.equal(disposals, 1);
	await assert.rejects(renderMotionCompositionFrame(evaluate([adjustment, red, blue]), { rasterizer: own, compositor: { begin() { throw new Error('Must not allocate.'); } } }), /replace.*CPU/u);
});
