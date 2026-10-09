/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BLACK_WHITE_MIX_PROCESS_V1, normalizeBlackWhiteMixEffectV1, prepareBlackWhiteMixEffectV1,
	applyBlackWhiteMixPixelV1, blackWhiteMixPreviewPassV1 } from '../src/common/editor/video-black-white-mix-v1.ts';

const KEYS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
const CENTERS = [[254,0,0],[254,127,0],[254,254,0],[0,254,0],[0,254,254],[0,0,254],[127,0,254],[254,0,254]];
const BASE = [54,144,235,182,200,19,46,72];
const effect = (params = {}, enabled = true) => ({ id: 'mono', type: 'black-white-mix-v1', enabled, params });
function render(params = {}, source = CENTERS.flatMap((rgb,i) => [...rgb,[0,1,127,255][i%4]!]), enabled = true) {
	const prepared = prepareBlackWhiteMixEffectV1(effect(params, enabled)), pixels = new Uint8Array(source);
	for (let offset=0;offset<pixels.length;offset+=4) applyBlackWhiteMixPixelV1(prepared,pixels,offset);
	return [...pixels];
}

test('enabled zero controls convert to the independent Rec709 gray baseline; disabled keeps every byte', () => {
	assert.equal(BLACK_WHITE_MIX_PROCESS_V1, 'srgb-bw-hue-q16-v1');
	assert.deepEqual(render(), BASE.flatMap((gray,i) => [gray,gray,gray,[0,1,127,255][i%4]!]));
	assert.equal(blackWhiteMixPreviewPassV1(effect())?.code,22);
	const source = [254,127,0,0,0,0,254,1];
	assert.deepEqual(render({orange:100},source,false),source);
	assert.equal(blackWhiteMixPreviewPassV1(effect({},false)),null);
});

test('each of eight independently constructed hue centers owns its authored control and exact alpha', () => {
	for (const [index,key] of KEYS.entries()) {
		const expected = BASE.map((gray,i) => i===index ? Math.min(255,gray+64) : gray);
		assert.deepEqual(render({[key]:25}),expected.flatMap((gray,i) => [gray,gray,gray,[0,1,127,255][i%4]!]),key);
	}
	assert.deepEqual(render({orange:-25},[254,127,0,127]),[81,81,81,127]); // -63.5 rounds toward +infinity.
	assert.deepEqual(render({orange:25},[254,127,0,127]),[208,208,208,127]);
	assert.deepEqual(render({red:25},[254,0,1,0,254,1,0,1]),[117,117,117,0,117,117,117,1]);
});

test('all gray levels remain unchanged regardless of hue controls and prepared coefficients detach', () => {
	const source = Array.from({length:256},(_,n)=>[n,n,n,n]).flat();
	assert.deepEqual(render(Object.fromEntries(KEYS.map(key=>[key,100])),source),source);
	const input=effect({red:12.5,orange:-37.125}),prepared=prepareBlackWhiteMixEffectV1(input);
	assert.equal(Reflect.set(input.params,'red',100),true);
	assert.deepEqual(prepared.params0,[8192,-24330,0,0]);
	assert.ok(Object.isFrozen(prepared.params0));assert.ok(Object.isFrozen(prepared.params1));assert.ok(Object.isFrozen(prepared));
});

test('all256 multichannel samples match an independent BigInt hue/interpolation reference', () => {
	const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,[0,1,127,255][n%4]!]).flat();
	for(const controls of [[100,-100,100,-100,100,-100,100,-100],[12.5,-37.125,33.3,-73.25,50,100,-100,0],[-25,-25,-25,-25,-25,-25,-25,-25]]) {
		const params=Object.fromEntries(KEYS.map((key,i)=>[key,controls[i]!])),expected:number[]=[];
		for(let i=0;i<source.length;i+=4){const gray=reference(source.slice(i,i+3),controls);expected.push(gray,gray,gray,source[i+3]!);}
		assert.deepEqual(render(params,source),expected);
	}
});

test('owning admission rejects hostile descriptors, future fields, invalid values and IDs before getters', () => {
	let reads=0;const accessor=Object.defineProperty({},'red',{enumerable:true,get(){reads++;return 0;}});
	for(const input of [{...effect(),future:1},{...effect(),type:'black-white-mix-v2'},{...effect(),id:'x'.repeat(129)},
		{...effect(),enabled:0},effect({orange:100.01}),effect({blue:NaN}),effect({future:0}),effect(accessor)]) assert.throws(()=>normalizeBlackWhiteMixEffectV1(input));
	assert.equal(reads,0);const normalized=normalizeBlackWhiteMixEffectV1(effect());
	assert.deepEqual(normalized.params,Object.fromEntries(KEYS.map(key=>[key,0])));assert.ok(Object.isFrozen(normalized.params));
});

// Independent rational implementation: exact signed floor division, no production classifier/kernel.
function reference(rgb:number[],controls:number[]):number {
	const [r,g,b]=rgb.map(BigInt) as [bigint,bigint,bigint],max=[r,g,b].reduce((a,c)=>a>c?a:c),min=[r,g,b].reduce((a,c)=>a<c?a:c),c=max-min;
	const y=(54n*r+183n*g+19n*b+128n)/256n;if(c===0n)return Number(y);
	let n=max===r?g-b:max===g?b-r+2n*c:r-g+4n*c;if(n<0n)n+=6n*c;
	const h=((n*512n+c)/(2n*c))%1536n,centers=[0n,128n,256n,512n,768n,1024n,1152n,1280n,1536n];
	const left=centers.findIndex((_,i)=>i<8&&h<centers[i+1]!);
	const p=controls.map(value=>BigInt(Math.round(value/100*65536))),width=centers[left+1]!-centers[left]!,distance=h-centers[left]!;
	const a=p[left]!,z=p[(left+1)%8]!,mix=a+floor((z-a)*distance+width/2n,width);
	const result=y+floor(c*mix+32768n,65536n);return Number(result<0n?0n:result>255n?255n:result);
}
function floor(n:bigint,d:bigint):bigint{return n>=0n?n/d:-((-n+d-1n)/d);}
