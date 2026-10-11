/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import Init from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionSurface, validateMotionSurface, type MotionSurface } from '../src/common/editor/motion-surface.ts';
import { applyMotionEffects, motionEffectParameters } from '../src/common/editor/motion-effect-rendering.ts';
import { VIDEO_EFFECT_TYPES } from '../src/common/editor/video-effects.js';
import type { MotionEffect } from '../src/common/editor/motion-composition.ts';
import type { MotionTrackingQuad } from '../src/common/editor/motion-tracking-homography.ts';

const kit = await Init(); const project = createMotionscaperProject({ id: 'pin', title: 'Pin', compositionId: 'main', width: 32, height: 32 });
const backend = () => createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const pin = (points: MotionTrackingQuad): MotionEffect => ({ id: 'pin', type: 'corner-pin', enabled: true, parameters: points.map((point, index) => ({ id: names[index]!, value: motionVector(point) })) });
const identity: MotionTrackingQuad = [[0, 0], [8, 0], [8, 8], [0, 8]];
const frame = (effects: readonly MotionEffect[], time: number = 0) => {
	const source = createMotionLayer({ id: 'solid', name: 'Card', durationFrames: 300, content: { kind: 'solid', color: motionColor([0.5, 0, 0, 0.5]), size: motionVector([8, 8]) } });
	return compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...source, effects, transform: { ...source.transform, position: motionVector([8, 8, 0]) } }] }] }).evaluate({ compositionId: 'main', time });
};
const pixel = (surface: MotionSurface, x: number, y: number) => [...surface.pixels.slice((y * surface.width + x) * 4, (y * surface.width + x) * 4 + 4)];

test('corner pin is a Motion-owned vector effect and preserves identity pixels, alpha and its consumed ledger', async () => {
	assert.equal(VIDEO_EFFECT_TYPES.includes('corner-pin'), false);
	const evaluated = frame([pin(identity)]); const warped = await renderMotionCompositionFrame(evaluated, { rasterizer: backend() });
	const base = await renderMotionCompositionFrame(frame([]), { rasterizer: backend() });
	assert.deepEqual(warped.pixels, base.pixels); assert.deepEqual(new Set(warped.consumedOperationIds), new Set(evaluated.requiredOperationIds));
});

test('corner pin resamples premultiplied projective pixels into bounded negative local origins without mutating input', async () => {
	const source = createMotionSurface(3, 2, [0, 0, 1, 0.5]); source.pixels.set([0.5, 0, 0, 0.5], 0);
	const saved = source.pixels.slice(); const effect = pin([[-4, 10], [2, 10], [2, 14], [-4, 14]]);
	const parameters = effect.parameters.map((parameter) => ({ id: parameter.id, value: parameter.value.value }));
	const scaled = await applyMotionEffects({ surface: source, origin: [-2, 5] }, [{ ...effect, parameters }], backend());
	assert.deepEqual(scaled.origin, [-4, 10]); assert.deepEqual([scaled.surface.width, scaled.surface.height], [6, 4]);
	assert.deepEqual(pixel(scaled.surface, 2, 2), [0.03125, 0, 0.46875, 0.5]); assert.deepEqual(pixel(scaled.surface, 3, 2), [0, 0, 0.5, 0.5]); assert.ok(pixel(scaled.surface, 1, 0)[0]! > 0); validateMotionSurface(scaled.surface); assert.deepEqual(source.pixels, saved);
	const quad: MotionTrackingQuad = [[-4, 2], [8, 0], [10, 12], [-2, 10]];
	const perspective = await renderMotionCompositionFrame(frame([pin(quad)]), { rasterizer: backend() });
	assert.ok(pixel(perspective, 10, 12)[3]! > 0.49); assert.equal(pixel(perspective, 4, 8)[3], 0); validateMotionSurface(perspective);
});

test('pin corners remain source-local after earlier expanded effects and animate through the shared evaluator', async () => {
	const outline: MotionEffect = { id: 'outline', enabled: true, type: 'outline', parameters: [{ id: 'width', value: motionScalar(2) }, { id: 'color', value: motionScalar(0xffffff) }, { id: 'opacity', value: motionScalar(1) }] };
	const result = await renderMotionCompositionFrame(frame([outline, pin([[0, 0], [12, 0], [12, 12], [0, 12]])]), { rasterizer: backend() });
	assert.equal(pixel(result, 7, 11)[3], 0); assert.deepEqual(pixel(result, 8, 11), [0.5, 0.5, 0.5, 0.5]); assert.equal(pixel(result, 11, 11)[1], 0);
	const moving = { ...pin(identity), parameters: identity.map(([x, y], index) => ({ id: names[index]!, value: { ...motionVector([x, y]), curves: [{ anchors: [{ position: { num: 0, den: 1 }, value: x }, { position: { num: 30, den: 1 }, value: x + 4 }], segments: [{ kind: 'linear' as const }] }, null] as const } })) };
	const translated = await renderMotionCompositionFrame(frame([moving], 1), { rasterizer: backend() });
	assert.equal(pixel(translated, 8, 11)[3], 0); assert.deepEqual(pixel(translated, 12, 11), [0.25, 0, 0, 0.5]);
});

test('pin convexity, closed parameters, renderer capability and memory bounds refuse before composition allocation', async () => {
	let allocated = 0; const compositor = { begin() { allocated++; throw new Error('Must not allocate.'); } };
	const raster = backend();
	for (const points of [[[0, 0], [8, 8], [8, 0], [0, 8]], [[0, 0], [8, 0], [8, 0], [0, 8]], [[0, 0], [5000, 0], [5000, 5000], [0, 5000]]] as readonly MotionTrackingQuad[]) {
		await assert.rejects(renderMotionCompositionFrame(frame([pin(points)]), { rasterizer: raster, compositor }), /convex|nondegenerate|budget/u);
	}
	const malformed = { ...pin(identity), parameters: [{ id: 'top-left', value: motionScalar(1) }] };
	await assert.rejects(renderMotionCompositionFrame(frame([malformed]), { rasterizer: raster, compositor }), /corner|vector|parameter/u);
	await assert.rejects(renderMotionCompositionFrame(frame([pin(identity)]), { rasterizer: { ...raster, supportedEffectTypes: [] }, compositor }), /corner.pin.*unavailable/u);
	await assert.rejects(renderMotionCompositionFrame(frame([pin(identity)]), { rasterizer: raster, compositor, maximumWorkingBytes: 32 }), /budget/u);
	assert.equal(allocated, 0);
	assert.throws(() => motionEffectParameters({ id: 'pin', type: 'corner-pin', enabled: true, parameters: [{ id: 'extra', value: [0, 0] }] }), /corner|parameter/u);
});

test('a projective render yields to cancellation without publishing pixels or changing its borrowed source', async () => {
	const source = createMotionSurface(2, 2, [1, 0, 0, 0.5]); const saved = source.pixels.slice(); const cancellation = new AbortController();
	const effect = pin([[0, 0], [512, 0], [512, 512], [0, 512]]);
	const parameters = effect.parameters.map((parameter) => ({ id: parameter.id, value: parameter.value.value }));
	let published = false;
	const pending = applyMotionEffects({ surface: source, origin: [0, 0] }, [{ ...effect, parameters }], backend(), cancellation.signal).then(() => { published = true; });
	setTimeout(() => cancellation.abort(new Error('Stop pin.')), 0);
	await assert.rejects(pending, /Stop pin/u); assert.equal(published, false); assert.deepEqual(source.pixels, saved);
});
