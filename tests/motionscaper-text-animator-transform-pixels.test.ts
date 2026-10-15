/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Init from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionTextAnimator, type MotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';

const kit = await Init();
const bytes = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2', import.meta.url)));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const font: MotionAsset = { kind: 'font', id: 'font', name: 'Nunito Sans', family: 'Nunito Sans', style: 'Regular', sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}`, mimeType: 'font/woff2' };
const project = createMotionscaperProject({ id: 'animator-transform-pixels', title: 'Transforms', compositionId: 'main', width: 320, height: 180 });
const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [font], fallbackFonts: [], async loadAsset() { return bytes; } });
const animator = createMotionTextAnimator('animate');
function layer(text: string, animators: readonly MotionTextAnimator[] = []) {
	return createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [{ text, fontAssetId: font.id,
		fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([160, 96]), animators } } });
}
async function render(own: ReturnType<typeof layer>) {
	const frame = compileMotionscaperProject({ ...project, assets: [font], compositions: [{ ...project.compositions[0], layers: [own] }] }).evaluate({ compositionId: 'main', time: 0 });
	return motionSurfaceToRgba8(await renderMotionCompositionFrame(frame, { rasterizer }), 'srgb');
}
async function shaped(text: string) {
	const frame = compileMotionscaperProject({ ...project, assets: [font], compositions: [{ ...project.compositions[0], layers: [layer(text)] }] }).evaluate({ compositionId: 'main', time: 0 });
	const state = frame.layers[0]!.state; if (state.kind !== 'text') throw new Error('Expected text.');
	return rasterizer.shapeText(state.document);
}
function assertPixels(actual: Readonly<Uint8Array | Uint8ClampedArray>, reference: Readonly<Uint8Array | Uint8ClampedArray>): void {
	assert.equal(actual.length, reference.length);
	let maximum = 0; let visible = 0;
	for (let i = 0; i < actual.length; i++) { maximum = Math.max(maximum, Math.abs(actual[i]! - reference[i]!)); if (i % 4 === 3 && reference[i]) visible++; }
	assert.ok(visible > 100, 'The reference must contain readable shaped coverage.');
	assert.ok(maximum <= 1, `Independent reference differs by ${maximum} channel codes.`);
}

for (const mode of ['scale', 'rotation'] as const) test(`M06 whole-line text ${mode} matches the independent layer-transform pixel path`, async () => {
	const text = 'office'; const own = layer(text); const baseline = await render(own);
	const shape = await shaped(text); const run = shape.lines[0]!.runs[0]!;
	assert.ok(run.clusters.some((offset, i) => i > 0 && offset - run.clusters[i - 1]! > 1), 'Keep the shaped ligature in the transform fixture.');
	// Move the shaped-line pivot to the document origin. The reference has no
	// animator: the existing layer transform owns its independent matrix path.
	const anchor = motionVector([-run.positions[0]!, -run.positions[1]!]);
	const scale = mode === 'scale' ? [2, 1.5] as const : [1, 1] as const;
	const rotation = mode === 'rotation' ? 90 : 0; const position = mode === 'rotation' ? [70, 0] as const : [20, 10] as const;
	const actual = await render(layer(text, [{ ...animator, selector: { ...animator.selector, unit: 'line' }, anchor, scale: motionVector(scale), rotation: motionScalar(rotation), position: motionVector(position) }]));
	const reference = await render({ ...own, transform: { ...own.transform, position: motionVector([...position, 0]), scale: motionVector([...scale, 1]), rotation: motionVector([0, 0, rotation]) } });
	assert.notDeepEqual(reference, baseline, 'A neutral transform cannot satisfy this oracle.');
	assertPixels(actual, reference);
});

test('M06 word tracking preserves the shaped first word and translates the second coverage by exactly twelve pixels', async () => {
	const text = 'office office'; const baseline = await render(layer(text)); const shape = await shaped(text);
	const second = shape.lines[0]!.runs.flatMap(run => run.clusters.map((offset, index) => ({ offset, x: run.positions[index * 2]! }))).filter(glyph => glyph.offset >= 7);
	assert.ok(second.length > 0); const boundary = Math.floor(Math.min(...second.map(glyph => glyph.x)));
	const reference = new Uint8Array(baseline.length);
	for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
		const source = x < boundary ? x : x >= boundary + 12 ? x - 12 : -1;
		if (source >= 0) reference.set(baseline.subarray((y * 320 + source) * 4, (y * 320 + source) * 4 + 4), (y * 320 + x) * 4);
	}
	const actual = await render(layer(text, [{ ...animator, selector: { ...animator.selector, unit: 'word' }, tracking: motionScalar(12) }]));
	assert.notDeepEqual(reference, baseline, 'The second word must visibly move.');
	assertPixels(actual, reference);
});
