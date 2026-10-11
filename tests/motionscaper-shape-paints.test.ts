/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionEllipsePath, motionPolygonPath, motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import type { MotionFill } from '../src/common/editor/motion-fill.ts';

const runtime = CanvasKitInit();
const project = createMotionscaperProject({ id: 'project', title: 'Paint', compositionId: 'main', width: 4, height: 4 });
const stops = [{ id: 'start', offset: motionScalar(0), color: motionColor([1, 0, 0, 1]) }, { id: 'end', offset: motionScalar(1), color: motionColor([0, 1, 0, 0]) }];
const withFill = (fill: MotionFill) => ({ ...project, compositions: [{ ...project.compositions[0]!, layers: [createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300,
	content: { kind: 'shapes', shapes: [{ id: 'rect', path: motionRectanglePath({ x: 0, y: 0, width: 4, height: 4 }), fill, stroke: null }] } })] }] });
const render = async (value: unknown) => renderMotionCompositionFrame(compileMotionscaperProject(value).evaluate({ compositionId: 'main', time: 0 }), {
	rasterizer: createCanvasKitMotionRasterizer(await runtime, { assets: [], fallbackFonts: [], loadAsset: () => Promise.reject(new Error('No asset expected')) }),
});

test('M04 typed gradient stops survive validation and interpolate premultiplied linear color without transparent fringes', async () => {
	const value = withFill({ kind: 'linear-gradient', start: motionVector([0, 0]), end: motionVector([4, 0]), stops });
	assert.deepEqual(normalizeMotionscaperProject(JSON.parse(JSON.stringify(value))), normalizeMotionscaperProject(value));
	const result = await render(value);
	for (let x = 0; x < 4; x++) {
		const alpha = 1 - (x + 0.5) / 4;
		assert.deepEqual([...result.pixels.slice(x * 4, x * 4 + 4)], [alpha, 0, 0, alpha]);
	}
	const radial = await render(withFill({ kind: 'radial-gradient', center: motionVector([2, 2]), radius: motionScalar(2), stops }));
	assert.ok(radial.pixels[(1 * 4 + 1) * 4 + 3]! > radial.pixels[3]!);
});

test('M04 malformed gradients reject on admission and animated stop crossings refuse rendering', async () => {
	const gradient = { kind: 'linear-gradient' as const, start: motionVector([0, 0]), end: motionVector([4, 0]), stops };
	assert.throws(() => withFill({ ...gradient, stops: [stops[0]!] }), /stops/iu);
	assert.throws(() => withFill({ ...gradient, stops: [stops[0]!, { ...stops[1]!, id: 'start' }] }), /duplicate/iu);
	const crossing = { ...gradient, stops: [stops[0]!, { ...stops[1]!, offset: { ...motionScalar(1), curve: {
		anchors: [{ position: { num: 0, den: 1 }, value: -1 }, { position: { num: 30, den: 1 }, value: 1 }], segments: [{ kind: 'linear' as const }],
	} } }] };
	await assert.rejects(render(withFill(crossing)), /gradient stops.*order|gradient stop.*range/iu);
});

test('M04 primitives produce portable editable Bezier geometry with bounded parameters', () => {
	const rect = motionRectanglePath({ x: 5, y: 10, width: 80, height: 40, radius: 8 });
	assert.equal(rect.value.closed, true); assert.equal(rect.value.vertices.length, 8);
	assert.deepEqual(rect.value.vertices[0]!.point, [13, 10]);
	const ellipse = motionEllipsePath({ center: [25, 30], radius: [20, 10] });
	assert.equal(ellipse.value.vertices.length, 4);
	assert.deepEqual(ellipse.value.vertices[0]!.point, [45, 30]);
	assert.ok(ellipse.value.vertices[0]!.outTangent[1] > 5);
	assert.equal(motionPolygonPath({ center: [0, 0], radius: 50, points: 5, innerRadius: 20 }).value.vertices.length, 10);
	assert.throws(() => motionPolygonPath({ center: [0, 0], radius: 50, points: 5000 }), /points/iu);
	assert.throws(() => motionEllipsePath({ center: [0, 0], radius: [0, 10] }), /radius/iu);
});
