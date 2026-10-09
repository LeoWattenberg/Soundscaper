/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// This routed entry contains test-only native renderer qualification code.
test.use({ browserCoverage: false });
const MODULE = '/__global_develop_webgl_native.js';
const ENTRY = new URL('../helpers/global-develop-webgl-native-fixture.ts', import.meta.url);
const SOURCE = [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 255, 224, 16, 255];
const effect = (type, params = {}, id = type) => ({ id, type, enabled: true, params });
const GOLDENS = [
	['temperature', [effect('white-balance-v1', { temperature: 100 })], [0, 32, 44, 0, 90, 128, 140, 1, 176, 128, 92, 127, 255, 224, 9, 255]],
	['tint', [effect('white-balance-v1', { tint: 100 })], [0, 20, 76, 0, 76, 92, 224, 1, 150, 92, 150, 127, 255, 164, 21, 255]],
	['exposure', [effect('tone-ladder-v1', { exposure: 1 })], [0, 47, 90, 0, 90, 176, 255, 1, 176, 176, 176, 127, 255, 255, 26, 255]],
	['contrast', [effect('tone-ladder-v1', { contrast: 50 })], [0, 0, 0, 0, 0, 137, 240, 1, 137, 137, 137, 127, 255, 255, 0, 255]],
	['highlights', [effect('tone-ladder-v1', { highlights: -100 })], [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 225, 207, 16, 255]],
	['shadows', [effect('tone-ladder-v1', { shadows: 100 })], [137, 140, 147, 0, 147, 163, 192, 1, 163, 163, 163, 127, 255, 224, 138, 255]],
	['whites', [effect('tone-ladder-v1', { whites: -100 })], [0, 32, 64, 0, 64, 128, 192, 1, 128, 128, 128, 127, 225, 224, 16, 255]],
	['blacks', [effect('tone-ladder-v1', { blacks: 100 })], [137, 140, 143, 0, 143, 131, 192, 1, 131, 131, 131, 127, 255, 224, 138, 255]],
];

test('real WebGL2 global passes match independent straight-alpha byte goldens and every neutral byte', async ({ page }) => {
	await prepare(page);
	for (const [name, effects, expected] of GOLDENS) {
		const result = await qualify(page, { source: SOURCE, effects, mode: 'target' });
		expect(result.nativeWebgl2, name).toBe(true); expect(result.globalProgramLinks, name).toBe(2);
		expect(result.pixels, name).toEqual(expected); expect(result.cpuPixels, name).toEqual(expected);
		expect(result.nativeReadbacks, name).toBe(1); expect(result.glError, name).toBe(0);
	}
	const all = Array.from({ length: 256 }, (_, byte) => [byte, 255 - byte, byte, byte]).flat();
	for (const effects of [[effect('white-balance-v1')], [effect('tone-ladder-v1')],
		[{ ...effect('tone-ladder-v1', { exposure: 5 }), enabled: false }]]) {
		const result = await qualify(page, { source: all, effects, mode: 'target' });
		expect(result.pixels).toEqual(all); expect(result.cpuPixels).toEqual(all);
	}
});

test('real compiled shaders retain per-operation rounding over all256 levels and variable coefficients', async ({ page }) => {
	await prepare(page);
	const source = Array.from({ length: 256 }, (_, byte) => [byte, (byte * 17) % 256, 255 - byte, [0, 1, 127, 255][byte % 4]]).flat();
	for (const effects of [
		[effect('white-balance-v1', { temperature: 73, tint: -41 })],
		[effect('tone-ladder-v1', { exposure: 0.37, contrast: 29, highlights: -63, shadows: 47, whites: 21, blacks: -33 })],
		[effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1', { exposure: -1 })],
		[effect('tone-ladder-v1', { exposure: -1 }), effect('white-balance-v1', { temperature: 100 })],
	]) {
		const result = await qualify(page, { source, effects, mode: 'target' });
		expect(result.pixels).toEqual(result.cpuPixels); expect(result.glError).toBe(0);
	}
});

test('actual Frame commands persist both operations and mixed exact rendering consumes native shaders', async ({ page }) => {
	await prepare(page);
	const source = [64, 128, 192, 255, 255, 224, 16, 255];
	const result = await qualify(page, { source, effects: [effect('white-balance-v1', { temperature: 100 }),
		effect('tone-ladder-v1')], mode: 'frame' });
	// A neutral legacy color-adjust forces the actual mixed Frame WebGL route.
	// The independently calculated source is opaque, avoiding a composition-alpha conversion claim.
	expect(result.authoredTypes).toEqual(['white-balance-v1', 'tone-ladder-v1', 'color-adjust']);
	expect(result.pixels).toEqual([90, 128, 140, 255, 255, 224, 9, 255]);
	expect(result.nativeReadbacks).toBeGreaterThan(0);
});

test('transparent presentation explicitly retains the compositor premultiplied output semantics', async ({ page }) => {
	await prepare(page);
	const source = [128, 128, 128, 0, 128, 128, 128, 1, 128, 128, 128, 127, 128, 128, 128, 255];
	const result = await qualify(page, { source, effects: [effect('tone-ladder-v1', { exposure: 1 })], mode: 'presentation' });
	expect(result.pixels).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 88, 88, 88, 127, 176, 176, 176, 255]);
	expect(result.nativeReadbacks).toBe(1); expect(result.glError).toBe(0);
});

test('actual mixed Frame effects retain straight RGB at alpha0/1/127/255 and native row order', async ({ page }) => {
	await prepare(page);
	const effects = [effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1')];
	const source = [64, 128, 192, 0, 64, 128, 192, 1, 64, 128, 192, 127, 64, 128, 192, 255];
	const result = await qualify(page, { source, effects, mode: 'frame' });
	expect(result.pixels).toEqual([90, 128, 140, 0, 90, 128, 140, 1, 90, 128, 140, 127, 90, 128, 140, 255]);
	expect(result.nativeWebgl2).toBe(true); expect(result.nativeReadbacks).toBe(1);
	const rows = await qualify(page, { source: [64, 128, 192, 0, 255, 224, 16, 1, 128, 128, 128, 127, 0, 32, 64, 255],
		height: 2, effects, mode: 'frame' });
	expect(rows.pixels).toEqual([90, 128, 140, 0, 255, 224, 9, 1, 176, 128, 92, 127, 0, 32, 44, 255]);
	expect(rows.nativeWebgl2).toBe(true); expect(rows.nativeReadbacks).toBe(1);
});

test('native straight readback cancellation joins cleanup and wipes undelivered pixels without inspecting its reason', async ({ page }) => {
	await prepare(page);
	const result = await qualify(page, { source: SOURCE, effects: [effect('white-balance-v1', { temperature: 100 })], mode: 'frame-cancel' });
	expect(result.nativeWebgl2).toBe(true); expect(result.nativeReadbacks).toBe(1);
	expect(result.rejectedWithReason).toBe(true); expect(result.reasonTraps).toBe(0); expect(result.abandonedOutputZero).toBe(true);
});

test('mixed Frame spatial effects preserve the maintained top-origin incomplete-block alignment', async ({ page }) => {
	await prepare(page);
	const source = [10, 40, 90, 140, 180].flatMap(value => [value, value, value, 255, value, value, value, 255]);
	const result = await qualify(page, { source, height: 5,
		effects: [{ ...effect('white-balance-v1'), enabled: false }], mode: 'frame-spatial' });
	// The unchanged LINEAR legacy sampler blends the last one-row block to175.
	// This vector avoids the prior200-tail half-byte tie; no rounding tolerance is allowed.
	const expected = [25, 25, 115, 115, 175].flatMap(value => [value, value, value, 255, value, value, value, 255]);
	expect(result.pixels).toEqual(expected); expect(result.legacyPresentationPixels).toEqual(expected);
	expect(result.authoredTypes).toEqual(['white-balance-v1', 'pixelate']);
	expect(result.nativeWebgl2).toBe(true); expect(result.nativeReadbacks).toBe(2);
});

test('actual integer chroma shader matches independent saturation and adaptive vibrance straight-alpha goldens', async ({page})=>{
	await prepare(page);
	for(const [params,expected]of [
		[{saturation:-100},[28,28,28,0,119,119,119,1,128,128,128,127,215,215,215,255]],
		[{saturation:100},[0,36,100,0,9,137,255,1,128,128,128,127,255,233,0,255]],
	]){
		const result=await qualify(page,{source:SOURCE,effects:[effect('chroma-v1',params)],mode:'target'});
		expect(result.chromaProgramLinked).toBe(true);expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	}
	const vibrant=await qualify(page,{source:[64,128,192,127,100,110,120,1,255,0,0,0],effects:[effect('chroma-v1',{vibrance:100})],mode:'target'});
	expect(vibrant.pixels).toEqual([37,132,228,127,92,111,130,1,255,0,0,0]);expect(vibrant.glError).toBe(0);
});

test('actual chroma native target retains exact all256 multichannel integer rounding and ordered global passes',async({page})=>{
	await prepare(page);const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,[0,1,127,255][n%4]]).flat();
	for(const [saturation,vibrance]of [[12.5,-37.125],[-33.3,73.25],[100,100],[-100,-100]]){
		const expected=[];for(let i=0;i<source.length;i+=4)expected.push(...chromaReference(source.slice(i,i+3),saturation,vibrance),source[i+3]);
		const result=await qualify(page,{source,effects:[effect('chroma-v1',{saturation,vibrance})],mode:'target'});
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	}
	for(const effects of [[effect('white-balance-v1',{temperature:73}),effect('chroma-v1',{vibrance:100})],
		[effect('chroma-v1',{vibrance:100}),effect('white-balance-v1',{temperature:73})],
		[effect('chroma-v1')],[{...effect('chroma-v1',{vibrance:100}),enabled:false}]]){
		const result=await qualify(page,{source,effects,mode:'target'});expect(result.pixels).toEqual(result.cpuPixels);expect(result.glError).toBe(0);
	}
});

test('actual Frame authoring and mixed native renderer preserve chroma at every alpha including hidden RGB',async({page})=>{
	await prepare(page);const source=[0,1,127,255].flatMap(alpha=>[64,128,192,alpha]);
	const result=await qualify(page,{source,effects:[effect('chroma-v1',{saturation:100})],mode:'frame'});
	expect(result.authoredTypes).toEqual(['chroma-v1','color-adjust']);
	expect(result.pixels).toEqual([0,1,127,255].flatMap(alpha=>[9,137,255,alpha]));
	expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
});

// Independent BigInt reference, not the CPU/shader owner; division explicitly floors negative adaptive gain.
function chromaReference(input,saturation,vibrance){
	const Q=65536n,sat=BigInt(Math.round((1+saturation/100)*65536)),vib=BigInt(Math.round(vibrance/100*65536));
	const step=(rgb,factor)=>{const y=(54n*rgb[0]+183n*rgb[1]+19n*rgb[2]+128n)/256n;
		return rgb.map(c=>{const n=y*Q+(c-y)*factor+Q/2n;return n<=0n?0n:n>=255n*Q?255n:n/Q;});};
	const rgb=step(input.map(BigInt),sat),range=rgb.reduce((a,b)=>a>b?a:b)-rgb.reduce((a,b)=>a<b?a:b),n=vib*(255n-range)+127n;
	return step(rgb,Q+(n>=0n?n/255n:-((-n+254n)/255n))).map(Number);
}

async function prepare(page) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', ENTRY)), contents:
		`export { qualifyGlobalDevelopWebglV1 } from ${JSON.stringify(fileURLToPath(ENTRY))};` },
		bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript',
		headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).framescaper : browserProductSiteForBuild('framescaper').origin;
	await page.goto(`${origin}/en/`);
}
async function qualify(page, request) {
	return page.evaluate(async ({ path, request }) => (await import(new URL(path, location.href).href)).qualifyGlobalDevelopWebglV1(request),
		{ path: MODULE, request });
}
