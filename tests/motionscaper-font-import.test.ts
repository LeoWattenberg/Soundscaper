/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import CanvasKitInit from 'canvaskit-wasm';
import { prepareMotionFont } from '../src/common/editor/motion-font-import.ts';
import { verifyMotionAssetBody } from '../src/common/editor/motion-asset.ts';
const kit = await CanvasKitInit();
test('M06 retained font import validates actual pinned shaper decoding and content addressing', async () => {
	const bytes = await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2', import.meta.url));
	const prepared = await prepareMotionFont(new Blob([bytes]), { id: 'bold', name: 'Inter Bold.woff2', style: 'Bold' }, kit);
	assert.equal(prepared.asset.kind, 'font'); assert.equal(prepared.asset.family, 'Inter'); assert.equal(prepared.asset.style, 'Bold'); assert.equal(prepared.asset.mimeType, 'font/woff2');
	verifyMotionAssetBody(prepared.asset, new Uint8Array(await prepared.body.arrayBuffer()));
});
test('M06 malformed, oversized and cancelled font imports refuse before native font construction', async () => {
	const options = { id: 'bad', name: 'bad.woff2', style: 'Regular' }; let reads = 0;
	const oversized = new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]); oversized.arrayBuffer = () => { reads++; throw new Error('No bytes expected'); };
	await assert.rejects(prepareMotionFont(oversized, options, kit), /budget|size/iu); assert.equal(reads, 0);
	await assert.rejects(prepareMotionFont(new Blob([new Uint8Array(20)]), options, kit), /font|format/iu);
	const controller = new AbortController(); controller.abort(); await assert.rejects(prepareMotionFont(oversized, options, kit, controller.signal), { name: 'AbortError' });
});
