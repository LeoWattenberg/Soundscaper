/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { encodeMotionPng } from '../src/common/editor/motion-png.ts';
import { motionColor, motionScalar, motionVector, normalizeMotionProperty } from '../src/common/editor/motion-property.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';
import { createMotionRasterRuntimeLoader } from '../src/common/editor/controller/composition/motion-raster-runtime.ts';

const runtime = CanvasKitInit();
const fontBytes = await readFile(new URL('../node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2', import.meta.url));
const digest = createHash('sha256').update(fontBytes).digest('hex');
const font: MotionAsset = { kind: 'font', id: 'font', name: 'Nunito Sans', family: 'Nunito Sans', style: 'Regular', sha256: digest, byteLength: fontBytes.length, storageKey: `motion-sha256:${digest}`, mimeType: 'font/woff2' };
const fallbackFonts = await Promise.all(['latin', 'latin-ext', 'greek', 'cyrillic'].map(async (subset) => ({ id: `inter-${subset}`, bytes: new Uint8Array(await readFile(new URL(`../node_modules/@fontsource/inter/files/inter-${subset}-400-normal.woff2`, import.meta.url))) })));
const project = createMotionscaperProject({ id: 'project', title: 'Raster', compositionId: 'main', width: 256, height: 96 });
const frame = (layers: readonly MotionLayer[]) => compileMotionscaperProject({ ...project, assets: [font], compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time: 0 });
const text = (value: string) => createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: {
	runs: [{ text: value, fontAssetId: 'font', fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }],
	align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([150, 96]),
} } });
const rasterizer = async () => createCanvasKitMotionRasterizer(await runtime, { assets: [font], loadAsset: () => Promise.resolve(new Uint8Array(fontBytes)), fallbackFonts });

test('M04 image dimensions are checked before pixel readback and decoded image disposal survives refusal', async () => {
	const kit = await runtime; const bytes = encodeMotionPng(kit, createMotionSurface(2, 2));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const image: MotionAsset = { id: 'image', name: 'Image', kind: 'image', byteLength: bytes.length, sha256,
		storageKey: `motion-sha256:${sha256}`, mimeType: 'image/png', width: 1, height: 1, hasAlpha: true };
	let reads = 0; let deleted = 0;
	const observedKit = { ...kit, MakeImageFromEncoded(data: Uint8Array) {
		const decoded = kit.MakeImageFromEncoded(data);
		if (decoded) {
			const read = decoded.readPixels.bind(decoded); const dispose = decoded.delete.bind(decoded);
			decoded.readPixels = (...args) => { reads += 1; return read(...args); };
			decoded.delete = () => { deleted += 1; dispose(); };
		}
		return decoded;
	} };
	const raster = createCanvasKitMotionRasterizer(observedKit, { assets: [image], loadAsset: () => Promise.resolve(bytes), fallbackFonts: [] });
	const layer = createMotionLayer({ id: 'image-layer', name: 'Image', durationFrames: 300, content: { kind: 'image', assetId: image.id } });
	const evaluated = compileMotionscaperProject({ ...project, assets: [image], compositions: [{ ...project.compositions[0], layers: [layer] }] }).evaluate({ compositionId: 'main', time: 0 });
	await assert.rejects(renderMotionCompositionFrame(evaluated, { rasterizer: raster }), /dimensions differ/u);
	assert.equal(reads, 0); assert.equal(deleted, 1);
});

test('M04 lazy runtime initialization retries failures, shares one load and isolates cancelled consumers', async () => {
	let calls = 0;
	const value = { kit: await runtime, fallbackFonts };
	const load = createMotionRasterRuntimeLoader(() => ++calls === 1 ? Promise.reject(new Error('Offline cache incomplete')) : Promise.resolve(value));
	assert.equal(calls, 0);
	await assert.rejects(load(), /Offline/iu);
	const cancellation = new AbortController();
	const cancelled = load(cancellation.signal);
	const survivor = load(); cancellation.abort();
	await assert.rejects(cancelled, { name: 'AbortError' });
	assert.equal(await survivor, value);
	assert.equal(await load(), value);
	assert.equal(calls, 2);
});

test('M04 real paragraph shaping preserves ligatures, multilingual fallback and line wrapping', async () => {
	const raster = await rasterizer();
	const value = frame([text('office Grüße κόσμος Привет')]).layers[0]!.state;
	assert.equal(value.kind, 'text');
	if (value.kind !== 'text') throw new Error('Unexpected fixture');
	const shaped = await raster.shapeText(value.document);
	assert.ok(shaped.lines.length >= 3);
	assert.ok(shaped.lines.some((line) => line.runs.some((run) => run.clusters.some((cluster, index) => index > 0 && cluster - run.clusters[index - 1]! > 1))), 'the fi ligature keeps its multi-character cluster');
	assert.deepEqual(shaped.unresolvedCodepoints, []);
	const rendered = await renderMotionCompositionFrame(frame([text('office Grüße κόσμος Привет')]), { rasterizer: raster });
	const pixels = motionSurfaceToRgba8(rendered, 'srgb');
	assert.ok(pixels.filter((_, index) => index % 4 === 3 && pixels[index]! > 0).length > 700, 'real readable glyph coverage');
	assert.equal(createHash('sha256').update(pixels).digest('hex'), 'a3544fa1354a027a0c2826989ee20a50d66b105f70f988c7e30c2aab7cf39ff5');
	assert.deepEqual((await renderMotionCompositionFrame(frame([text('office Grüße κόσμος Привет')]), { rasterizer: raster })).pixels, rendered.pixels);
});

test('M04 missing glyphs and corrupt imported font bytes produce actionable rendering failures', async () => {
	await assert.rejects(renderMotionCompositionFrame(frame([text('👽')]), { rasterizer: await rasterizer() }), /missing glyph.*U\+1F47D/iu);
	const corrupt = createCanvasKitMotionRasterizer(await runtime, { assets: [font], loadAsset: () => Promise.resolve(new Uint8Array([1])), fallbackFonts });
	await assert.rejects(renderMotionCompositionFrame(frame([text('Hello')]), { rasterizer: corrupt }), /digest|length/iu);
});

test('M04 cubic geometry and float antialiasing preserve linear color and alpha edges', async () => {
	const path = normalizeMotionProperty({ kind: 'path', value: { closed: true, vertices: [
		{ point: [10.5, 10.5], inTangent: [0, 0], outTangent: [20, -10] },
		{ point: [60.5, 10.5], inTangent: [-20, -10], outTangent: [0, 0] },
		{ point: [60.5, 60.5], inTangent: [0, 0], outTangent: [0, 0] },
		{ point: [10.5, 60.5], inTangent: [0, 0], outTangent: [0, 0] },
	] }, keyframes: [], segments: [], expression: null });
	assert.equal(path.kind, 'path'); if (path.kind !== 'path') throw new Error('Unexpected fixture');
	const shape = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'curve', path, fill: motionColor([0.5, 0.25, 0, 0.5]), stroke: null }] } });
	const rendered = await renderMotionCompositionFrame(frame([shape]), { rasterizer: await rasterizer() });
	const center = (30 * 256 + 30) * 4;
	assert.deepEqual([...rendered.pixels.slice(center, center + 4)], [0.25, 0.125, 0, 0.5]);
	const edge = (30 * 256 + 10) * 4;
	assert.ok(rendered.pixels[edge + 3]! > 0 && rendered.pixels[edge + 3]! < 0.5);
	assert.ok(Math.abs(rendered.pixels[edge]! / rendered.pixels[edge + 3]! - 0.5) < 1e-6);
	assert.ok(rendered.pixels[(5 * 256 + 35) * 4 + 3]! > 0, 'Bezier tangents curve above the rectangular endpoints');
});
