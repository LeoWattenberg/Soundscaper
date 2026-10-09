/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const syntheticRouteTest = test.extend({ browserCoverage: false });
const ENTRY=new URL('../helpers/framescaper-global-export-fixture.ts',import.meta.url);
syntheticRouteTest('native highp integer post-crop vignette matches literal signed corners and every straight alpha byte',async({page})=>{
	const path='/__post_crop_vignette_native.js',bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('.',ENTRY)),contents:
		`export {qualifyPostCropVignetteNativeV1} from ${JSON.stringify(fileURLToPath(ENTRY))};`},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
	await page.context().route(`**${path}`,route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text,
		headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}}));
	const origin=process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS?JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).framescaper:browserProductSiteForBuild('framescaper').origin;
	await page.goto(`${origin}/en/`);
	const results=await page.evaluate(async path=>(await import(new URL(path,location.href).href)).qualifyPostCropVignetteNativeV1(),path);
	const dark=[16,8,31,127],bright=[240,232,255,127],identity=[128,64,255,127];
	const corners=corner=>[corner,identity,corner,identity,identity,identity,corner,identity,corner].flat();
	const alpha=Array.from({length:256},(_,n)=>n===0?[0,255,0,0]:[0,0,0,n]).flat();
	const narrow=Array.from({length:4095},(_,n)=>n===2047?identity:[0,0,0,127]).flat();
	const protectedHighlights=[255,255,255,127,65,32,16,127];
	expect(results).toHaveLength(5);
	for(const[result,expected]of results.map((result,n)=>[result,[corners(dark),corners(bright),alpha,narrow,protectedHighlights][n]])){
		expect(result.pixels).toEqual(expected);expect(result.cpu).toEqual(expected);expect(result.source).toEqual(result.before);
	}
});
