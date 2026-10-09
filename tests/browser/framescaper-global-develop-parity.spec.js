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

test('actual monochrome shader owns eight hue centers, red wrap and signed half rounding with unchanged alpha',async({page})=>{
	await prepare(page);
	const source=[[254,0,0],[254,127,0],[254,254,0],[0,254,0],[0,254,254],[0,0,254],[127,0,254],[254,0,254]]
		.flatMap((rgb,i)=>[...rgb,[0,1,127,255][i%4]]);
	for(const [params,grays]of [[{},[54,144,235,182,200,19,46,72]],
		[{red:5,orange:10,yellow:-15,green:-20,aqua:-5,blue:2,purple:15,magenta:20},[67,169,197,131,187,24,84,123]]]){
		const expected=grays.flatMap((gray,i)=>[gray,gray,gray,[0,1,127,255][i%4]]);
		const result=await qualify(page,{source,effects:[effect('black-white-mix-v1',params)],mode:'target'});
		expect(result.blackWhiteProgramLinked).toBe(true);expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	}
	const negative=await qualify(page,{source:[254,127,0,127],effects:[effect('black-white-mix-v1',{orange:-25})],mode:'target'});
	expect(negative.pixels).toEqual([81,81,81,127]);expect(negative.cpuPixels).toEqual([81,81,81,127]);expect(negative.glError).toBe(0);
	const wrap=await qualify(page,{source:[254,0,1,0,254,1,0,1],effects:[effect('black-white-mix-v1',{red:25})],mode:'target'});
	expect(wrap.pixels).toEqual([117,117,117,0,117,117,117,1]);expect(wrap.glError).toBe(0);
});

test('actual monochrome shader retains all256 multichannel/gray bytes, disabled identity and authored operation order',async({page})=>{
	await prepare(page);const keys=['red','orange','yellow','green','aqua','blue','purple','magenta'];
	const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,[0,1,127,255][n%4]]).flat();
	const controls=[12.5,-37.125,33.3,-73.25,50,100,-100,25],params=Object.fromEntries(keys.map((key,i)=>[key,controls[i]])),expected=[];
	for(let i=0;i<source.length;i+=4){const gray=blackWhiteReference(source.slice(i,i+3),controls);expected.push(gray,gray,gray,source[i+3]);}
	const result=await qualify(page,{source,effects:[effect('black-white-mix-v1',params)],mode:'target'});
	expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	for(const effects of [[effect('white-balance-v1',{temperature:73}),effect('black-white-mix-v1',params)],
		[effect('black-white-mix-v1',params),effect('white-balance-v1',{temperature:73})],
		[{...effect('black-white-mix-v1',params),enabled:false}]]){
		const output=await qualify(page,{source,effects,mode:'target'});expect(output.pixels).toEqual(output.cpuPixels);expect(output.glError).toBe(0);
	}
	const gray=Array.from({length:256},(_,n)=>[n,n,n,n]).flat();
	const grays=await qualify(page,{source:gray,effects:[effect('black-white-mix-v1',Object.fromEntries(keys.map(key=>[key,100])))],mode:'target'});
	expect(grays.pixels).toEqual(gray);expect(grays.cpuPixels).toEqual(gray);expect(grays.glError).toBe(0);
});

test('actual Frame authoring/mixed native renderer preserves monochrome hidden RGB and alpha0/1/127/255',async({page})=>{
	await prepare(page);const source=[0,1,127,255].flatMap(alpha=>[254,127,0,alpha]);
	const result=await qualify(page,{source,effects:[effect('black-white-mix-v1',{orange:-25})],mode:'frame'});
	expect(result.authoredTypes).toEqual(['black-white-mix-v1','color-adjust']);
	expect(result.pixels).toEqual([0,1,127,255].flatMap(alpha=>[81,81,81,alpha]));
	expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
});

test('actual HSL shader owns eight original-hue bands, signed ties and fractional wrapped controls',async({page})=>{
	await prepare(page);const colors=['red','orange','yellow','green','aqua','blue','purple','magenta'];
	const centers=[[254,0,0],[254,127,0],[254,254,0],[0,254,0],[0,254,254],[0,0,254],[127,0,254],[254,0,254]];
	const rotated=[[254,254,0],[127,254,0],[0,254,0],[0,254,254],[0,0,254],[254,0,254],[254,0,127],[254,0,0]];
	const source=centers.flatMap((rgb,i)=>[...rgb,[0,1,127,255][i%4]]);
	for(const [index,color]of colors.entries()){
		const result=await qualify(page,{source,effects:[effect('hsl-mixer-v1',{[`${color}Hue`]:60})],mode:'target'});
		const expected=centers.flatMap((rgb,i)=>[...(i===index?rotated[i]:rgb),[0,1,127,255][i%4]]);
		expect(result.hslProgramLinked).toBe(true);expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	}
	for(const [params,expected]of [[{redHue:73.25,redSaturation:-37.125,redLuminance:33.3},[200,224,117,127]],
		[{redHue:-37.125},[255,0,158,127]],[{redLuminance:-50},[128,0,0,127]],[{redHue:180},[0,255,255,127]]]){
		const result=await qualify(page,{source:[255,0,0,127],effects:[effect('hsl-mixer-v1',params)],mode:'target'});
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	}
});

test('actual HSL native target matches all256 rational multichannel/alpha values, neutral/gray identity and both authored orders',async({page})=>{
	await prepare(page);const colors=['red','orange','yellow','green','aqua','blue','purple','magenta'];
	const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat();
	const controls=[180,-180,73.25,-37.125,12.5,0,120,-60,100,-100,33.3,-73.25,12.5,-37.125,50,0,100,-100,33.3,-73.25,12.5,-37.125,50,0];
	const params=Object.fromEntries(['Hue','Saturation','Luminance'].flatMap((suffix,group)=>colors.map((color,i)=>[`${color}${suffix}`,controls[group*8+i]]))),expected=[];
	for(let i=0;i<source.length;i+=4)expected.push(...hslReference(source.slice(i,i+3),controls),source[i+3]);
	const result=await qualify(page,{source,effects:[effect('hsl-mixer-v1',params)],mode:'target'});
	expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.glError).toBe(0);
	for(const effects of [[effect('white-balance-v1',{temperature:73}),effect('hsl-mixer-v1',params)],
		[effect('hsl-mixer-v1',params),effect('white-balance-v1',{temperature:73})],
		[effect('hsl-mixer-v1')],[{...effect('hsl-mixer-v1',params),enabled:false}]]){
		const output=await qualify(page,{source,effects,mode:'target'});expect(output.pixels).toEqual(output.cpuPixels);expect(output.glError).toBe(0);
	}
	const gray=Array.from({length:256},(_,n)=>[n,n,n,n]).flat(),grays=await qualify(page,{source:gray,effects:[effect('hsl-mixer-v1',params)],mode:'target'});
	expect(grays.pixels).toEqual(gray);expect(grays.cpuPixels).toEqual(gray);expect(grays.glError).toBe(0);
});

test('actual Frame authoring and mixed native renderer preserve fractional HSL hidden RGB and every sampled alpha',async({page})=>{
	await prepare(page);const source=[0,1,127,255].flatMap(alpha=>[255,0,0,alpha]);
	const result=await qualify(page,{source,effects:[effect('hsl-mixer-v1',{redHue:73.25,redSaturation:-37.125,redLuminance:33.3})],mode:'frame'});
	expect(result.authoredTypes).toEqual(['hsl-mixer-v1','color-adjust']);
	expect(result.pixels).toEqual([0,1,127,255].flatMap(alpha=>[200,224,117,alpha]));
	expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);
});

// Independent exact rational reference: no production HSL classifier/kernel.
function hslReference(rgb,controls){
	const Q=65536n,v=rgb.map(BigInt),max=v.reduce((a,b)=>a>b?a:b),min=v.reduce((a,b)=>a<b?a:b),c=max-min;if(c===0n)return rgb;
	const abs=n=>n<0n?-n:n,clamp=(n,lo,hi)=>n<lo?lo:n>hi?hi:n;
	const nearest=(n,d)=>{const value=2n*n+d;return value>=0n?value/(2n*d):-((-value+2n*d-1n)/(2n*d));};
	let n=max===v[0]?v[1]-v[2]:max===v[1]?v[2]-v[0]+2n*c:v[0]-v[1]+4n*c;if(n<0n)n+=6n*c;
	const h=(n*512n+c)/(2n*c),centers=[0n,128n,256n,512n,768n,1024n,1152n,1280n,1536n],left=centers.findIndex((_,i)=>i<8&&h<centers[i+1]);
	const coeff=controls.map((value,i)=>BigInt(Math.round(value/(i<8?60:100)*65536))),width=centers[left+1]-centers[left],distance=h-centers[left];
	const mix=group=>{const a=coeff[group*8+left],z=coeff[group*8+(left+1)%8];return a+nearest((z-a)*distance,width);};
	const hue=mix(0),sat=mix(1),lum=mix(2),l=max+min,d=255n-abs(l-255n),saturated=clamp(nearest(c*(Q+sat),Q),0n,d);
	const nextL=l+nearest((lum>=0n?510n-l:l)*lum,Q),nextD=255n-abs(nextL-255n),nextC=clamp(nearest(saturated*nextD,d),0n,nextD),base=nextL-nextC;
	if(hue===0n)return v.map(channel=>Number(clamp(nearest(base*c+2n*nextC*(channel-min),2n*c),0n,255n)));
	const phase=((nearest(n*Q,c)+hue)%(6n*Q)+6n*Q)%(6n*Q),sector=Number(phase/Q),x=nextC*(Q-abs(phase%(2n*Q)-Q)),top=nextC*Q;
	return [[top,x,0n],[x,top,0n],[0n,top,x],[0n,x,top],[x,0n,top],[top,0n,x]][sector].map(channel=>Number(clamp(nearest(base*Q+2n*channel,2n*Q),0n,255n)));
}

// Independent BigInt reference uses exact rational hue and signed floor division.
function blackWhiteReference(rgb,controls){
	const [r,g,b]=rgb.map(BigInt),max=[r,g,b].reduce((a,c)=>a>c?a:c),min=[r,g,b].reduce((a,c)=>a<c?a:c),c=max-min;
	const y=(54n*r+183n*g+19n*b+128n)/256n;if(c===0n)return Number(y);
	let n=max===r?g-b:max===g?b-r+2n*c:r-g+4n*c;if(n<0n)n+=6n*c;
	const h=((n*512n+c)/(2n*c))%1536n,centers=[0n,128n,256n,512n,768n,1024n,1152n,1280n,1536n];
	const left=centers.findIndex((_,i)=>i<8&&h<centers[i+1]),p=controls.map(value=>BigInt(Math.round(value/100*65536)));
	const floor=(value,divisor)=>value>=0n?value/divisor:-((-value+divisor-1n)/divisor);
	const width=centers[left+1]-centers[left],a=p[left],z=p[(left+1)%8],mix=a+floor((z-a)*(h-centers[left])+width/2n,width);
	const gray=y+floor(c*mix+32768n,65536n);return Number(gray<0n?0n:gray>255n?255n:gray);
}

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
