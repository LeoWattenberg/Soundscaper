/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import CanvasKitInit from 'canvaskit-wasm';
import { prepareMotionFont } from '../src/common/editor/motion-font-import.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
const kit = await CanvasKitInit();
const fixtures = new URL('./fixtures/motionscaper-fonts/', import.meta.url);
async function prepare(id: 'arabic' | 'cjk') {
	const bytes = await readFile(new URL(`${id}.woff2`, fixtures));
	return { bytes, ...await prepareMotionFont(new Blob([bytes]), { id, name: `${id}.woff2`, style: 'Regular' }, kit) };
}
async function fixture(id: 'arabic' | 'cjk', text: string, width = 240) {
	const font = await prepare(id);
	const project = createMotionscaperProject({ id: 'scripts', title: 'Retained scripts', compositionId: 'main', width, height: 160 });
	const layer = createMotionLayer({ id: 'text', name: text, durationFrames: 300, content: { kind: 'text', document: {
		runs: [{ text, fontAssetId: id, fontSize: motionScalar(32), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }],
		align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([width, 160]),
	} } });
	const frame = compileMotionscaperProject({ ...project, assets: [font.asset], compositions: [{ ...project.compositions[0]!, layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
	const state = frame.layers[0]!.state; if (state.kind !== 'text') throw new Error('Expected text.');
	const raster = createCanvasKitMotionRasterizer(kit, { assets: [font.asset], fallbackFonts: [], async loadAsset() { return font.bytes; } });
	const shaped = await raster.shapeText(state.document), surface = await renderMotionCompositionFrame(frame, { rasterizer: raster });
	return { shaped, pixels: motionSurfaceToRgba8(surface, 'srgb') };
}
test('M04 retained Arabic font shapes joined RTL clusters without a system font provider', async () => {
	const joined = await fixture('arabic', 'سَلَام مرحبا');
	assert.deepEqual(joined.shaped.unresolvedCodepoints, []);
	const clusters = joined.shaped.lines.flatMap(line => line.runs.flatMap(run => run.clusters));
	assert.ok(clusters.some((value, index) => index > 0 && value < clusters[index - 1]!), 'Arabic clusters follow RTL visual order');
	const separated = await fixture('arabic', 'سَ لَ ا م م ر ح ب ا');
	const isolatedGlyphs = new Set(separated.shaped.lines.flatMap(line => line.runs.flatMap(run => run.glyphs)));
	assert.ok(joined.shaped.lines.some(line => line.runs.some(run => run.glyphs.some(glyph => !isolatedGlyphs.has(glyph)))), 'joining chooses contextual glyph forms absent from isolated letters');
	assert.ok(clusters.some((value, index) => index > 0 && value === clusters[index - 1]!), 'combining marks keep the shared shaped cluster');
	assert.ok(joined.pixels.some((value, index) => index % 4 === 3 && value > 0));
	assert.equal(createHash('sha256').update(joined.pixels).digest('hex'), '6afd9c4adac82e2e93400809983908f17e56d06323d3cd91c1d5ea90025bad2e');
});
test('M04 retained CJK font wraps ideographs and draws distinct glyphs from explicit bytes', async () => {
	const result = await fixture('cjk', '中文测试，动画。', 100);
	assert.deepEqual(result.shaped.unresolvedCodepoints, []); assert.ok(result.shaped.lines.length >= 3);
	assert.ok(new Set(result.shaped.lines.flatMap(line => line.runs.flatMap(run => run.glyphs))).size >= 7);
	assert.ok(result.pixels.some((value, index) => index % 4 === 3 && value > 0));
	assert.deepEqual(result.shaped.lines[0]!.runs[0]!.clusters, [0, 3, 6, 9]);
	assert.equal(createHash('sha256').update(result.pixels).digest('hex'), '0d9350471b7af016751608eb6adcd03b626e59b4903ba1e84fc500e23e1c9e91');
});
test('M04 script font fixtures retain licensed package byte hashes', async () => {
	const manifest = JSON.parse(await readFile(new URL('sources.json', fixtures), 'utf8')) as { fonts: { id: 'arabic' | 'cjk'; sha256: string; byteLength: number; license: string; licenseSha256: string }[] };
	for (const entry of manifest.fonts) {
		const { bytes } = await prepare(entry.id), license = await readFile(new URL(entry.license, fixtures));
		assert.equal(bytes.byteLength, entry.byteLength); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
		assert.equal(createHash('sha256').update(license).digest('hex'), entry.licenseSha256); assert.match(license.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/u);
	}
});
