/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import CanvasKitInit from 'canvaskit-wasm';
import { importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import type { MotionSurface } from '../src/common/editor/motion-surface.ts';
import { decodeMotionChannel } from '../src/common/editor/motion-surface.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';

export const motionAuthoredSha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** Read only the small, newly authored fixture; archive import verifies its full retained asset closure. */
export async function readMotionAuthoredReference(root: string, archivePath: string) {
	const metadata = await stat(archivePath); assert.ok(metadata.isFile() && metadata.size <= 5 * 1024 * 1024);
	const archiveBytes = await readFile(archivePath); assert.equal(archiveBytes.length, metadata.size);
	const assets = new Map<string, Uint8Array>(), staging = new Map<string, Uint8Array[]>(); let stagedBytes = 0;
	const imported = await importMotionscaperArchive(new Blob([new Uint8Array(archiveBytes)]), () => ({
		writeAssetChunk(asset, bytes) {
			stagedBytes += bytes.length; assert.ok(stagedBytes <= 5 * 1024 * 1024);
			const chunks = staging.get(asset.id) ?? []; chunks.push(Uint8Array.from(bytes)); staging.set(asset.id, chunks); return Promise.resolve();
		},
		finishAsset(asset) { const chunks = staging.get(asset.id); assert.ok(chunks); assets.set(asset.id, Uint8Array.from(Buffer.concat(chunks))); staging.delete(asset.id); return Promise.resolve(); },
		commit() { return Promise.resolve(); }, rollback() { assets.clear(); staging.clear(); return Promise.resolve(); },
	}));
	assert.equal(imported.kind, 'current'); if (imported.kind !== 'current') throw new Error('Authored save became opaque.');
	const project = imported.project; assert.equal(project.title, 'Desktop authored title'); assert.equal(project.compositions.length, 1);
	const composition = project.compositions[0]!;
	assert.deepEqual([composition.width, composition.height, composition.durationFrames, composition.frameRate], [160, 96, 2, { num: 30, den: 1 }]);
	assert.equal(composition.layers.length, 2); assert.deepEqual(composition.layers.map(layer => layer.name), ['Title', 'Card']);
	const text = composition.layers[0]!; assert.equal(text.kind, 'text'); if (text.kind !== 'text') throw new Error('Authored text missing.');
	assert.equal(text.document.runs.length, 1); assert.equal(text.document.runs[0]!.text, 'Motion');
	assert.deepEqual(text.transform.position, motionVector([20, 20, 0])); assert.deepEqual(text.document.boxSize, motionVector([120, 40]));
	assert.deepEqual(text.document.runs[0]!.fontSize, motionScalar(24)); assert.deepEqual(text.document.runs[0]!.color, motionColor([1, 1, 1, 1]));
	const card = composition.layers[1]!; assert.equal(card.kind, 'shapes'); if (card.kind !== 'shapes') throw new Error('Authored rectangle missing.');
	assert.deepEqual(card.transform.position, motionVector([10, 8, 0])); assert.deepEqual(card.transform.opacity, motionScalar(1)); assert.equal(card.shapes.length, 1);
	assert.deepEqual(card.shapes[0]!.path.value.vertices.map(vertex => vertex.point), [[0, 0], [140, 0], [140, 64], [0, 64]]);
	assert.deepEqual(card.shapes[0]!.fill, motionColor([decodeMotionChannel(74 / 255, 'srgb'), decodeMotionChannel(128 / 255, 'srgb'), 1, 1]));
	const manifest: unknown = JSON.parse(await readFile(join(root, 'config/motionscaper-raster-runtime.json'), 'utf8'));
	assert.ok(manifest && typeof manifest === 'object'); const manifestAssets: unknown = Reflect.get(manifest, 'assets'); assert.ok(Array.isArray(manifestAssets));
	const fontPin: unknown = manifestAssets.find((value: unknown) => value && typeof value === 'object' && Reflect.get(value, 'id') === 'inter-latin');
	assert.ok(fontPin && typeof fontPin === 'object'); const fontSha: unknown = Reflect.get(fontPin, 'sha256'); assert.equal(typeof fontSha, 'string');
	assert.equal(project.assets.length, 1); const font = project.assets[0]!; assert.equal(font.kind, 'font'); assert.equal(font.sha256, fontSha);
	const fontBytes = assets.get(font.id); assert.ok(fontBytes); assert.equal(motionAuthoredSha(fontBytes), fontSha); assert.equal(text.document.runs[0]!.fontAssetId, font.id);
	const kit = await CanvasKitInit();
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: project.assets, fallbackFonts: [], loadAsset(asset) { const bytes = assets.get(asset.id); assert.ok(bytes); return Promise.resolve(bytes); } });
	const evaluator = compileMotionscaperProject(project), references: MotionSurface[] = [];
	for (const frame of [0, 1]) references.push(await renderMotionCompositionFrame(evaluator.evaluate({ compositionId: composition.id, time: { num: frame, den: 30 } }), { rasterizer }));
	return { references, archiveSha256: motionAuthoredSha(archiveBytes), retainedFontSha256: font.sha256 };
}
