/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionShapeOperator, createMotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';

const kit = await CanvasKitInit();
const project = createMotionscaperProject({ id: 'operator-admission', compositionId: 'main', title: 'Admission', width: 32, height: 32 });
const raster = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('Must not load.'); } });

test('backends without shape operators refuse before allocation and invalid parameters fail through direct local-raster entries', async () => {
	const layer = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'rect',
		path: motionRectanglePath({ x: 0, y: 0, width: 16, height: 16 }), fill: motionColor([1, 0, 0, 1]), stroke: null }],
		operators: [createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' })] } });
	const evaluate = (enabled: boolean) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...layer,
		operators: layer.kind === 'shapes' ? layer.operators!.map((operator) => ({ ...operator, enabled })) : [] }] }] }).evaluate({ compositionId: 'main', time: 0 });
	const frame = evaluate(true); let allocations = 0;
	await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer: { ...raster, supportedSourceOperations: [] }, compositor: { begin() { allocations++; throw new Error('Must not allocate.'); } } }), /shape-operator/u);
	const own = frame.layers[0]!; if (own.state.kind !== 'shapes') throw new Error('Unexpected fixture.');
	await assert.rejects(raster.rasterizeSource({ ...own, state: { ...own.state, operators: [{ id: 'trim', enabled: true, kind: 'trim-paths', start: 0, end: 2, offset: 0, mode: 'individual' }] } }, frame), /unit range/u);
	assert.equal(allocations, 0);
	const result = await renderMotionCompositionFrame(evaluate(false), { rasterizer: raster }); assert.equal(result.pixels[(8 * 32 + 8) * 4 + 3], 1);
});

test('a backend without shaped text animation refuses before font loading and invalid animated parameters fail at the direct entry', async () => {
	const digest = 'a'.repeat(64); const font = { id: 'font', name: 'Font', kind: 'font' as const, sha256: digest, byteLength: 4,
		storageKey: `motion-sha256:${digest}`, mimeType: 'font/woff2', family: 'Inter', style: 'Regular' };
	const layer = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: {
		runs: [{ text: 'office', fontAssetId: 'font', fontSize: motionScalar(20), tracking: motionScalar(0), color: motionColor([1, 1, 1, 1]) }],
		align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([32, 32]), animators: [createMotionTextAnimator('animate')] } } });
	const frame = compileMotionscaperProject({ ...project, assets: [font], compositions: [{ ...project.compositions[0], layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
	await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer: { ...raster, supportedSourceOperations: [] } }), /text-animator/u);
	const own = frame.layers[0]!; if (own.state.kind !== 'text') throw new Error('Unexpected fixture.');
	await assert.rejects(raster.rasterizeSource({ ...own, state: { ...own.state, document: { ...own.state.document, animators: [{ ...own.state.document.animators![0]!, opacity: 2 }] } } }, frame), /opacity.*range/u);
});
