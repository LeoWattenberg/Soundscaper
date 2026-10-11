/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import Init from 'canvaskit-wasm';
import type { CanvasKit, Path, PathBuilder } from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionShapeOperator } from '../src/common/editor/motion-authoring-operators.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import type { MotionShapeOperator } from '../src/common/editor/motion-authoring-operators.ts';
import type { MotionShape } from '../src/common/editor/motion-composition.ts';

const kit = await Init(); const project = createMotionscaperProject({ id: 'shapes', title: 'Shapes', compositionId: 'main', width: 64, height: 32 });
const raster = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const rect = (id: string, x: number = 0): MotionShape => ({ id, path: motionRectanglePath({ x, y: 4, width: 8, height: 8 }), fill: motionColor([1, 0, 0, 1]), stroke: null });
const frame = (operators: readonly MotionShapeOperator[], shapes: readonly MotionShape[] = [rect('one')], masked: boolean = false) => {
	const base = createMotionLayer({ id: 'layer', name: 'Shapes', durationFrames: 300, content: { kind: 'shapes', shapes, operators } });
	const layer = masked ? { ...base, masks: [{ id: 'mask', path: motionRectanglePath({ x: -40, y: 0, width: 40, height: 32 }), opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' as const }], transform: { ...base.transform, position: motionVector([32, 0, 0]) } } : base;
	return compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
};
const alpha = (surface: Awaited<ReturnType<typeof renderMotionCompositionFrame>>, x: number, y: number = 8) => surface.pixels[(y * 64 + x) * 4 + 3]!;
const repeat = createMotionShapeOperator({ id: 'repeat', kind: 'repeater' });

test('repeater copies preserve authored transforms, fractional opacity and negative local origins through masks', async () => {
	const own = { ...repeat, copies: motionScalar(2.5), transform: { ...repeat.transform, position: motionVector([12, 0]) } };
	const evaluated = frame([own]); const rendered = await renderMotionCompositionFrame(evaluated, { rasterizer: raster });
	assert.equal(alpha(rendered, 4), 1); assert.equal(alpha(rendered, 16), 1); assert.equal(alpha(rendered, 28), 0.5); assert.equal(alpha(rendered, 40), 0);
	assert.deepEqual(new Set(rendered.consumedOperationIds), new Set(evaluated.requiredOperationIds));
	const negative = await renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(2), offset: motionScalar(1), transform: { ...repeat.transform, position: motionVector([-12, 0]) } }], undefined, true), { rasterizer: raster });
	assert.equal(alpha(negative, 12), 1); assert.equal(alpha(negative, 24), 1); assert.equal(alpha(negative, 36), 0);
});

test('ordered boolean operators combine geometry while inheriting the first current shape appearance', async () => {
	const second = { ...rect('two', 4), fill: motionColor([0, 1, 0, 1]) };
	for (const [mode, expected] of Object.entries({ union: [1, 1, 1], subtract: [1, 0, 0], intersect: [0, 1, 0], xor: [1, 0, 1] })) {
		const operator = { ...createMotionShapeOperator({ id: 'boolean', kind: 'boolean' }), mode: mode as 'union' | 'subtract' | 'intersect' | 'xor' };
		const surface = await renderMotionCompositionFrame(frame([operator], [rect('one'), second]), { rasterizer: raster });
		assert.deepEqual([alpha(surface, 2), alpha(surface, 6), alpha(surface, 10)], expected); assert.equal(surface.pixels[(8 * 64 + 6) * 4 + 1], 0);
	}
});

test('trim paths retain perimeter arclength and simultaneous order across the current shape list', async () => {
	const path = motionRectanglePath({ x: 2, y: 4, width: 8, height: 8 });
	const stroke: MotionShape = { id: 'stroke', path, fill: null, stroke: { width: motionScalar(2), color: motionColor([1, 1, 1, 1]), lineCap: 'butt', lineJoin: 'miter' } };
	const trim = { ...createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' }), end: motionScalar(0.25) };
	const first = await renderMotionCompositionFrame(frame([trim], [stroke]), { rasterizer: raster });
	assert.equal(alpha(first, 6, 4), 1); assert.equal(alpha(first, 10, 8), 0); assert.equal(alpha(first, 6, 12), 0);
	const other = { ...stroke, id: 'other', path: motionRectanglePath({ x: 18, y: 4, width: 8, height: 8 }) };
	const simultaneous = await renderMotionCompositionFrame(frame([{ ...trim, mode: 'simultaneous', end: motionScalar(0.5) }], [stroke, other]), { rasterizer: raster });
	assert.equal(alpha(simultaneous, 6, 4), 1); assert.equal(alpha(simultaneous, 22, 4), 0);
});

test('repeater opacity isolates the complete fill and stroke appearance and moves gradient coordinates', async () => {
	const shape: MotionShape = { ...rect('gradient'), fill: { kind: 'linear-gradient', start: motionVector([0, 0]), end: motionVector([8, 0]), stops: [{ id: 'red', offset: motionScalar(0), color: motionColor([1, 0, 0, 1]) }, { id: 'blue', offset: motionScalar(1), color: motionColor([0, 0, 1, 1]) }] },
		stroke: { width: motionScalar(4), color: motionColor([0, 1, 0, 1]), lineCap: 'round', lineJoin: 'round' } };
	const surface = await renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(2), startOpacity: motionScalar(0.5), endOpacity: motionScalar(0.5), transform: { ...repeat.transform, position: motionVector([16, 0]) } }], [shape]), { rasterizer: raster });
	assert.equal(alpha(surface, 1), 0.5); assert.equal(alpha(surface, 17), 0.5);
	assert.deepEqual(Array.from(surface.pixels.slice((8 * 64 + 4) * 4, (8 * 64 + 4) * 4 + 4)), Array.from(surface.pixels.slice((8 * 64 + 20) * 4, (8 * 64 + 20) * 4 + 4)));
});

test('cubic trims use curved arclength, wrapped offsets and the authored operator order', async () => {
	const curve: MotionShape = { id: 'curve', fill: null, stroke: { width: motionScalar(2), color: motionColor([1, 1, 1, 1]), lineCap: 'butt', lineJoin: 'round' }, path: { kind: 'path', value: { closed: false, vertices: [{ point: [4, 20], inTangent: [0, 0], outTangent: [0, -16] }, { point: [28, 20], inTangent: [0, -16], outTangent: [0, 0] }] }, keyframes: [], segments: [], expression: null } };
	const trim = { ...createMotionShapeOperator({ id: 'curve-trim', kind: 'trim-paths' }), end: motionScalar(0.5) };
	const half = await renderMotionCompositionFrame(frame([trim], [curve]), { rasterizer: raster });
	assert.ok(alpha(half, 8, 11) > 0.5); assert.equal(alpha(half, 24, 11), 0);
	const wrapped = await renderMotionCompositionFrame(frame([{ ...trim, offset: motionScalar(0.75) }], [curve]), { rasterizer: raster });
	assert.ok(alpha(wrapped, 4, 16) > 0.5); assert.ok(alpha(wrapped, 27, 16) > 0.5); assert.equal(alpha(wrapped, 16, 8), 0);
	const stroke = { ...curve, path: motionRectanglePath({ x: 2, y: 4, width: 8, height: 8 }) };
	const copies = { ...repeat, copies: motionScalar(2), transform: { ...repeat.transform, position: motionVector([16, 0]) } };
	const simultaneous = { ...trim, mode: 'simultaneous' as const };
	const after = await renderMotionCompositionFrame(frame([copies, simultaneous], [stroke]), { rasterizer: raster });
	const before = await renderMotionCompositionFrame(frame([simultaneous, copies], [stroke]), { rasterizer: raster });
	assert.equal(alpha(after, 22, 4), 0); assert.equal(alpha(before, 22, 4), 1); assert.equal(alpha(after, 6, 12), 1); assert.equal(alpha(before, 6, 12), 0);
	const subtract = { ...createMotionShapeOperator({ id: 'cut', kind: 'boolean' }), mode: 'subtract' as const };
	const repeatAfter = await renderMotionCompositionFrame(frame([subtract, copies], [rect('first'), rect('cut', 4)]), { rasterizer: raster });
	const repeatBefore = await renderMotionCompositionFrame(frame([copies, subtract], [rect('first'), rect('cut', 4)]), { rasterizer: raster });
	assert.equal(alpha(repeatAfter, 18), 1); assert.equal(alpha(repeatBefore, 18), 0);
});

test('operator expansion, invalid scale powers and working bytes refuse before target allocation', async () => {
	let allocations = 0; const compositor = { begin() { allocations++; throw new Error('Must not allocate.'); } };
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(1025) }]), { rasterizer: raster, compositor }), /copies|range|budget/u);
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(100) }, { ...repeat, id: 'again', copies: motionScalar(100) }]), { rasterizer: raster, compositor }), /shape.*budget/u);
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...repeat, offset: motionScalar(0.5), transform: { ...repeat.transform, scale: motionVector([-1, 1]) } }]), { rasterizer: raster, compositor }), /scale|fraction/u);
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(2), transform: { ...repeat.transform, scale: motionVector([0, 1]) } }, createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' })]), { rasterizer: raster, compositor }), /nonsingular|nonzero/u);
	await assert.rejects(renderMotionCompositionFrame(frame([repeat]), { rasterizer: raster, compositor, maximumWorkingBytes: 64 }), /budget/u);
	assert.equal(allocations, 0);
});

test('native operator paths are released after successful rendering and a failed boolean stage', async () => {
	for (const failure of [false, true]) {
		const paths = new Set<Path>();
		const track = (path: Path): Path => {
			if (paths.has(path)) return path; paths.add(path);
			const copy = path.copy.bind(path); const trim = path.makeTrimmed.bind(path);
			path.copy = () => track(copy());
			path.makeTrimmed = (...args) => { const result = trim(...args); return result ? track(result) : null; };
			return path;
		};
		const native = { ...kit,
			PathBuilder: new Proxy(kit.PathBuilder, { construct(target, args) { const builder = Reflect.construct(target, args) as PathBuilder; const detach = builder.detach.bind(builder); builder.detach = () => track(detach()); return builder; } }),
			Path: new Proxy(kit.Path, { get(target, key, receiver) { if (key !== 'MakeFromOp') return Reflect.get(target, key, receiver) as unknown; return (...args: Parameters<CanvasKit['Path']['MakeFromOp']>) => { const result = failure ? null : kit.Path.MakeFromOp(...args); return result ? track(result) : null; }; } }),
		};
		const backend = createCanvasKitMotionRasterizer(native, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
		const request = renderMotionCompositionFrame(frame([{ ...repeat, copies: motionScalar(2), transform: { ...repeat.transform, position: motionVector([16, 0]) } }, { ...createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' }), end: motionScalar(0.75) }, createMotionShapeOperator({ id: 'union', kind: 'boolean' })]), { rasterizer: backend });
		if (failure) await assert.rejects(request, /could not be combined/u); else await request;
		assert.ok(paths.size >= 10); assert.ok([...paths].every((path) => path.isDeleted()));
	}
});
