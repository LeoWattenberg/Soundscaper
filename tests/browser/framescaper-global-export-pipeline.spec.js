/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The route serves test-only native capture/finishing executable code.
test.use({ browserCoverage: false });
const MODULE = '/__framescaper_global_export_pipeline.js';
const ENTRY = new URL('../helpers/framescaper-global-export-fixture.ts', import.meta.url);

test('native Canvas capture feeds authored globals into the production selected-finishing sRGB output', async ({ page }) => {
	const result = await qualify(page, 'opaque');
	expect(result.captured).toEqual([[0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]]);
	expect(result.effectedPixels).toEqual([0,20,29,255,64,92,101,255,128,92,65,255,188,164,5,255]);
	// Existing selected finishing has an explicit UNORM8 linear working packet.
	// This is the pre-encoder straight-sRGB result after that quantization.
	expect(result.pixels).toEqual([0,22,28,255,64,92,101,255,128,92,64,255,188,164,0,255]);
	expect(result.authoredTypes).toEqual(['white-balance-v1', 'tone-ladder-v1']);
	expect(result.consumedNodeIds.length).toBeGreaterThan(0);
	expect(result.sourceUnchanged).toEqual(result.captured[0]);
});

test('native capture and selected composition preserve ordered geometry legacy tone and partial alpha', async ({ page }) => {
	const result = await qualify(page, 'geometry-alpha');
	// Transparent black and partial-alpha white are exactly representable in
	// the native Canvas ingress; the opaque128 sample retains a nonneutral tone.
	const source = [0,0,0,0,255,255,255,1,255,255,255,127,128,128,128,255];
	const expected = [255,255,255,127,0,0,0,0,176,176,176,255,255,255,255,1];
	expect(result.captured).toEqual([source]); expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(expected); expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['develop-geometry-v1', 'color-adjust', 'tone-ladder-v1']);
	expect(result.nativeReadbacks).toBe(2); expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

test('native Canvas capture feeds persisted chroma into actual selected composition with independent pre-encode gray goldens',async({page})=>{
	const result=await qualify(page,'chroma');
	const source=[0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255];
	const expected=[28,28,28,255,119,119,119,255,128,128,128,255,215,215,215,255];
	expect(result.captured).toEqual([source]);expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(expected);expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['chroma-v1']);expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

test('native Canvas capture and selected composition retain authored monochrome before tone with independent pre-encode goldens',async({page})=>{
	const result=await qualify(page,'black-white');
	const source=[255,0,0,255,0,0,0,255,128,128,128,255,0,0,255,255];
	const expected=[188,188,188,255,0,0,0,255,92,92,92,255,188,188,188,255];
	expect(result.captured).toEqual([source]);expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(expected);expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['black-white-mix-v1','tone-ladder-v1']);expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

test('native Canvas capture and selected composition retain authored HSL before tone with independent pre-encode color goldens',async({page})=>{
	const result=await qualify(page,'hsl');
	const source=[255,0,0,255,0,0,0,255,128,128,128,255,0,0,255,255];
	const expected=[188,188,0,255,0,0,0,255,92,92,92,255,188,0,188,255];
	expect(result.captured).toEqual([source]);expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(expected);expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['hsl-mixer-v1','tone-ladder-v1']);expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

for (const reverse of [false, true]) test(`native Canvas and actual selected composition retain full point/parametric recipes; reverse=${String(reverse)}`, async ({ page }) => {
	const result = await qualify(page, reverse ? 'curves-reverse' : 'curves');
	const source = [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255];
	const effected = reverse ? [255,191,175,255,175,127,63,255,127,127,127,255,0,31,223,255]
		: [255,223,191,255,191,127,79,255,127,127,127,255,0,62,239,255];
	const expected = reverse ? [255,191,175,255,175,127,64,255,127,127,127,255,0,28,223,255]
		: [255,223,191,255,191,127,79,255,127,127,127,255,0,61,239,255];
	expect(result.captured).toEqual([source]); expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(effected); expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(reverse ? ['parametric-curves-v1', 'point-curves-v1'] : ['point-curves-v1', 'parametric-curves-v1']);
	expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

test('native Canvas capture and actual selected composition consume the persisted neighborhood recipe with exact pre-encode goldens', async ({ page }) => {
	const result=await qualify(page,'detail');
	const source=[40,80,120,255,100,140,180,255,160,200,240,255,220,60,20,255];
	expect(result.captured).toEqual([source]);expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual([0,47,92,255,85,162,217,255,175,252,255,255,255,17,0,255]);
	// Declared existing linear UNORM8 composition quantization:47→46 and17→13.
	expect(result.pixels).toEqual([0,46,92,255,85,162,217,255,175,252,255,255,255,13,0,255]);
	expect(result.authoredTypes).toEqual(['detail-sharpen-v1']);expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

test('native Canvas capture and selected composition consume persisted Clarity with exact declared pre-encode gray bytes',async({page})=>{
	const result=await qualify(page,'clarity'),source=[64,64,64,255,128,128,128,255,192,192,192,255,128,128,128,255];
	const expected=[38,38,38,255,135,135,135,255,217,217,217,255,121,121,121,255];
	expect(result.captured).toEqual([source]);expect(result.sourceUnchanged).toEqual(source);
	expect(result.effectedPixels).toEqual(expected);expect(result.pixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['clarity-v1']);expect(result.consumedNodeIds.length).toBeGreaterThan(0);
});

async function qualify(page, mode) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', ENTRY)), contents:
		`export { qualifyGlobalExportNativeV1 } from ${JSON.stringify(fileURLToPath(ENTRY))};` },
		bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript',
		headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).framescaper : browserProductSiteForBuild('framescaper').origin;
	await page.goto(`${origin}/en/`);
	return page.evaluate(async ({ path, mode }) => (await import(new URL(path, location.href).href)).qualifyGlobalExportNativeV1(mode), { path: MODULE, mode });
}
