/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Init from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import type { MotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import { createMotionParagraph } from '../src/common/editor/motion-canvaskit-text.ts';
import { motionTextSelectorWeight } from '../src/common/editor/motion-text-animation.ts';

const kit = await Init(); const bytes = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2', import.meta.url)));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const font: MotionAsset = { kind: 'font', id: 'font', name: 'Nunito Sans', family: 'Nunito Sans', style: 'Regular', sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}`, mimeType: 'font/woff2' };
const project = createMotionscaperProject({ id: 'text-animation', title: 'Text', compositionId: 'main', width: 256, height: 96 });
const raster = createCanvasKitMotionRasterizer(kit, { assets: [font], fallbackFonts: [], async loadAsset() { return bytes; } });
const animator = createMotionTextAnimator('animate');
const frame = (animators: readonly MotionTextAnimator[] = [], value: string = 'office Grüße') => {
	const layer = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [{ text: value, fontAssetId: 'font',
		fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([160, 96]), animators } } });
	return compileMotionscaperProject({ ...project, assets: [font], compositions: [{ ...project.compositions[0], layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
};
const render = (animators: readonly MotionTextAnimator[] = [], value?: string) => renderMotionCompositionFrame(frame(animators, value), { rasterizer: raster });

test('text animator neutral glyph drawing preserves whole paragraph shaping and consumes its ledger', async () => {
	const baseline = await render(); const own = frame([animator]); const animated = await renderMotionCompositionFrame(own, { rasterizer: raster });
	const differing = animated.pixels.findIndex((v, i) => v !== baseline.pixels[i]);
	assert.equal(differing, -1, `First different pixel ${differing / 4}: ${animated.pixels[differing]} vs ${baseline.pixels[differing]}`);
	assert.deepEqual(new Set(animated.consumedOperationIds), new Set(own.requiredOperationIds));
});

test('whole shaped-line position, color and opacity animation preserves glyph coverage beyond the original layout box', async () => {
	const baseline = await render([], 'office');
	const moved = await render([{ ...animator, selector: { ...animator.selector, unit: 'line' }, position: motionVector([170, 0]),
		color: motionColor([1, 0, 0, 1]), opacity: motionScalar(0.5) }], 'office');
	let count = 0;
	for (let y = 0; y < 96; y++) for (let x = 0; x < 86; x++) {
		const src = (y * 256 + x) * 4; const dst = (y * 256 + x + 170) * 4;
		assert.equal(moved.pixels[dst], baseline.pixels[src]! * 0.5); assert.equal(moved.pixels[dst + 1], 0); assert.equal(moved.pixels[dst + 2], 0);
		assert.equal(moved.pixels[dst + 3], baseline.pixels[src + 3]! * 0.5); if (moved.pixels[dst + 3]) count++;
	}
	assert.ok(count > 100);
});

test('cluster selectors retain a ligature as one shaped group and Unicode word selectors use UTF-8 shaping offsets', async () => {
	const own = frame([], 'office'); const state = own.layers[0]!.state; if (state.kind !== 'text') throw new Error('Unexpected fixture.');
	const shaped = await raster.shapeText(state.document); const offsets = [...new Set(shaped.lines.flatMap((line) => line.runs.flatMap((run) => run.clusters.slice(0, run.glyphs.length))))].sort((a, b) => a - b);
	const ligature = offsets.findIndex((offset, i) => i + 1 < offsets.length && offsets[i + 1]! - offset > 1); assert.ok(ligature >= 0);
	const hidden = await render([{ ...animator, selector: { ...animator.selector, start: motionScalar(ligature / offsets.length), end: motionScalar((ligature + 1) / offsets.length) }, opacity: motionScalar(0) }], 'office');
	const original = await render([], 'office'); assert.ok(hidden.pixels.some((v, i) => v !== original.pixels[i]));
	const firstWord = await render([{ ...animator, selector: { ...animator.selector, unit: 'word', start: motionScalar(0), end: motionScalar(0.5) }, opacity: motionScalar(0) }], 'éé office');
	const both = await render([], 'éé office'); let removed = 0; let retained = 0;
	for (let y = 0; y < 96; y++) for (let x = 0; x < 160; x++) {
		const i = (y * 256 + x) * 4 + 3;
		if (both.pixels[i] && !firstWord.pixels[i]) removed++; if (firstWord.pixels[i]) retained++;
	}
	assert.ok(removed > 100); assert.ok(retained > 100);
});

test('animated text parameter and shaping-work budgets refuse before target allocation or font loading', async () => {
	let allocations = 0; const compositor = { begin() { allocations++; throw new Error('Must not allocate.'); } };
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...animator, opacity: motionScalar(2) }]), { rasterizer: raster, compositor }), /opacity|range/u);
	await assert.rejects(renderMotionCompositionFrame(frame([{ ...animator, tracking: motionScalar(32768) }]), { rasterizer: raster, compositor }), /budget|dimensions/u);
	await assert.rejects(renderMotionCompositionFrame(frame([animator], 'a'.repeat(16385)), { rasterizer: raster, compositor }), /shaping-work budget/u);
	assert.equal(allocations, 0);
});

test('text selectors wrap offset ranges and ramp weights at shaped-unit centers', () => {
	const state = frame([animator]).layers[0]!.state; if (state.kind !== 'text') throw new Error('Unexpected fixture.');
	const own = state.document.animators![0]!;
	const shifted = { ...own, selector: { ...own.selector, start: 0, end: 0.5, offset: 0.75 } };
	assert.deepEqual([0, 1, 2, 3].map((index) => motionTextSelectorWeight(shifted, index, 4)), [1, 0, 0, 1]);
	const ramp = { ...own, selector: { ...own.selector, shape: 'ramp-up' as const } };
	assert.deepEqual([0, 1, 2, 3].map((index) => motionTextSelectorWeight(ramp, index, 4)), [0.125, 0.375, 0.625, 0.875]);
});

test('paragraph disposal releases the retained shaped typefaces once, including metric-only consumers', () => {
	const state = frame().layers[0]!.state; if (state.kind !== 'text') throw new Error('Unexpected fixture.');
	const paragraph = createMotionParagraph(kit, state.document, [{ id: font.id, bytes }], []);
	const faces = paragraph.shapedLines.flatMap((line) => line.runs.map((run) => run.typeface)); assert.ok(faces.length);
	assert.ok(faces.every((face) => !face.isDeleted())); paragraph.dispose(); paragraph.dispose();
	assert.ok(faces.every((face) => face.isDeleted()));
});
