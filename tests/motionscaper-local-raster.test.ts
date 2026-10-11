/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionLocalSourceBounds, motionSourceWorldMatrix } from '../src/common/editor/motion-local-raster.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { transformMotionSurface } from '../src/common/editor/motion-surface.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';

const kit = await CanvasKitInit();
const project = createMotionscaperProject({ id: 'local', compositionId: 'main', title: 'Local source', width: 64, height: 64 });
const evaluate = (layer: MotionLayer) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
const rasterizer = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No imported assets.'); } });

test('local source pixels precede authored world transforms and retain intrinsic solid dimensions', async () => {
	const base = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([0.5, 0.25, 0, 0.5]), size: motionVector([8, 6]) } });
	const frame = evaluate({ ...base, transform: { ...base.transform, position: motionVector([20, 30, 0]) } });
	const raster = rasterizer(); const local = await raster.rasterizeSource(frame.layers[0]!, frame);
	assert.deepEqual([local.surface.width, local.surface.height, local.origin], [8, 6, [0, 0]]);
	assert.deepEqual([...local.surface.pixels.subarray(0, 4)], [0.25, 0.125, 0, 0.5]);
	const transformed = transformMotionSurface(local.surface, 64, 64, motionSourceWorldMatrix(frame.layers[0]!.worldMatrix, local.origin));
	assert.deepEqual(transformed.pixels, (await raster.rasterize(frame.layers[0]!, frame)).pixels);
});

test('negative vector coordinates retain their source origin and survive later translation into the composition', async () => {
	const base = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [
		{ id: 'rectangle', path: motionRectanglePath({ x: -12, y: 8, width: 4, height: 4 }), fill: motionColor([1, 0, 0, 1]), stroke: null },
	] } });
	const frame = evaluate({ ...base, transform: { ...base.transform, position: motionVector([20, 0, 0]) } });
	const raster = rasterizer(); const local = await raster.rasterizeSource(frame.layers[0]!, frame);
	assert.deepEqual([local.surface.width, local.surface.height, local.origin], [4, 4, [-12, 8]]);
	const transformed = transformMotionSurface(local.surface, 64, 64, motionSourceWorldMatrix(frame.layers[0]!.worldMatrix, local.origin));
	assert.deepEqual(transformed.pixels, (await raster.rasterize(frame.layers[0]!, frame)).pixels);
});

test('source bounds include Bezier controls and miter coverage and reject oversized local surfaces before rasterization', () => {
	const base = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [
		{ id: 'rectangle', path: motionRectanglePath({ x: 0, y: 0, width: 8, height: 8 }), fill: motionColor([1, 0, 0, 1]), stroke: null },
	] } });
	const state = evaluate(base).layers[0]!.state; assert.equal(state.kind, 'shapes'); if (state.kind !== 'shapes') throw new Error('Bad fixture.');
	const path = { ...state.shapes[0]!.path, vertices: state.shapes[0]!.path.vertices.map((vertex, index) => index === 0 ? { ...vertex, outTangent: [0, -20] as const } : vertex) };
	const bounded = { ...state, shapes: [{ ...state.shapes[0]!, path, stroke: { color: [1, 1, 1, 1] as const, width: 4, lineCap: 'butt' as const, lineJoin: 'miter' as const } }] };
	assert.deepEqual(motionLocalSourceBounds(bounded, new Map()), { origin: [-8, -28], width: 24, height: 44, empty: false });
	assert.throws(() => motionLocalSourceBounds({ ...bounded, shapes: [{ ...bounded.shapes[0]!, path: { ...path, vertices: path.vertices.map((vertex, index) => index === 0 ? { ...vertex, outTangent: [100000, 100000] } : vertex) } }] }, new Map()), /surface|dimension/u);
});
