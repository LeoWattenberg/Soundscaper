/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface, compositeMotionSurfaces, motionSurfaceToRgba8, motionSurfaceFromRgba8, transformMotionSurface } from '../src/common/editor/motion-surface.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionTransformMatrix } from '../src/common/editor/motion-transform.ts';

const close = (a: ArrayLike<number>, b: readonly number[]) => b.forEach((value, index) => assert.ok(Math.abs(a[index]! - value) < 1e-6, `${index}: ${a[index]} != ${value}`));

test('M04 source-over blends premultiplied floats in linear light and converts output explicitly', () => {
	const below = createMotionSurface(1, 1, [0, 0, 1, 1]);
	const above = createMotionSurface(1, 1, [1, 0, 0, 0.5]);
	compositeMotionSurfaces(below, above, 'normal', 1);
	close(below.pixels, [0.5, 0, 0.5, 1]);
	assert.deepEqual([...motionSurfaceToRgba8(below, 'srgb')], [188, 0, 188, 255]);
	const transparent = createMotionSurface(1, 1);
	compositeMotionSurfaces(transparent, above, 'normal', 0.5);
	close(transparent.pixels, [0.25, 0, 0, 0.25]);
	assert.deepEqual([...motionSurfaceToRgba8(transparent, 'srgb')], [255, 0, 0, 64]);
});

test('M04 named blend formulas respect partial coverage instead of multiplying premultiplied colors', () => {
	const expected = { normal: 0.8, multiply: 0.2, screen: 0.85, overlay: 0.4, add: 1, darken: 0.25, lighten: 0.8, difference: 0.55, exclusion: 0.65 };
	for (const [blend, value] of Object.entries(expected)) {
		const below = createMotionSurface(1, 1, [0.25, 0.25, 0.25, 0.5]);
		const above = createMotionSurface(1, 1, [0.8, 0.8, 0.8, 0.5]);
		compositeMotionSurfaces(below, above, blend as keyof typeof expected, 1);
		close(below.pixels, [0.2625 + value * 0.25, 0.2625 + value * 0.25, 0.2625 + value * 0.25, 0.75]);
	}
});

test('M04 straight encoded assets decode before premultiplication and transparent resampling has no fringe', () => {
	const source = motionSurfaceFromRgba8(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]), 'srgb');
	close(source.pixels, [1, 0, 0, 1, 0, 0, 0, 0]);
	const matrix = motionTransformMatrix({ anchor: [0, 0, 0], position: [0.5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
	const transformed = transformMotionSurface(source, 3, 1, matrix);
	close(transformed.pixels, [0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0, 0, 0, 0]);
	assert.throws(() => createMotionSurface(100000, 100000), /budget/iu);
});

test('M04 composition rendering follows layer order, isolates precompositions and accounts for operations', async () => {
	const project = createMotionscaperProject({ id: 'project', title: 'Motion', compositionId: 'main', width: 2, height: 2 });
	const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([2, 2]), color: motionColor([1, 0, 0, 1]) } });
	const pre = createMotionLayer({ id: 'pre', name: 'Pre', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } });
	const child = { ...project.compositions[0]!, id: 'child', layers: [solid] };
	const frame = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], background: [0, 0, 1, 1], layers: [{ ...pre, transform: { ...pre.transform, opacity: motionScalar(0.5) } }] }, child] }).evaluate({ compositionId: 'main', time: 0 });
	let rasterizations = 0;
	const rendered = await renderMotionCompositionFrame(frame, { rasterizer: { rasterize(layer, target) {
		rasterizations++;
		assert.equal(layer.state.kind, 'solid');
		return Promise.resolve(createMotionSurface(target.width, target.height, [1, 0, 0, 1]));
	} } });
	close(rendered.pixels.slice(0, 4), [0.5, 0, 0.5, 1]);
	assert.equal(rasterizations, 1);
	assert.deepEqual([...rendered.consumedOperationIds].sort(), [...frame.requiredOperationIds].sort());
});

test('M04 unsupported authored operations refuse before rasterization and cancellation cannot publish pixels', async () => {
	const project = createMotionscaperProject({ id: 'project', title: 'Motion', compositionId: 'main', width: 2, height: 2 });
	const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([2, 2]), color: motionColor([1, 0, 0, 1]) } });
	const effects = [{ id: 'blur', type: 'blur', enabled: true, parameters: [] }];
	const frame = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...solid, effects }] }] }).evaluate({ compositionId: 'main', time: 0 });
	const rasterizer = { rasterize: () => Promise.reject(new Error('Should not rasterize')) };
	await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer }), /unsupported.*effect.*blur/iu);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer, signal: controller.signal }), { name: 'AbortError' });
});

test('M04 nested working surfaces are bounded before any target or source allocation', async () => {
	const project = createMotionscaperProject({ id: 'project', title: 'Bounded', compositionId: 'main', width: 8, height: 8 });
	const pre = (id: string) => createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: id } });
	const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 0, 0, 1]) } });
	const compositions = [{ ...project.compositions[0]!, layers: [pre('one')] }, { ...project.compositions[0]!, id: 'one', layers: [pre('two')] }, { ...project.compositions[0]!, id: 'two', layers: [solid] }];
	const frame = compileMotionscaperProject({ ...project, compositions }).evaluate({ compositionId: 'main', time: 0 });
	let allocations = 0;
	await assert.rejects(renderMotionCompositionFrame(frame, { maximumWorkingBytes: 4096,
		compositor: { retainedSurfaceCount: 1, begin() { allocations++; throw new Error('Unexpected allocation'); } },
		rasterizer: { rasterize() { allocations++; return Promise.reject(new Error('Unexpected allocation')); } },
	}), /working.*budget/iu);
	assert.equal(allocations, 0);
});
