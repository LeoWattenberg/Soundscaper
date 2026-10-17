/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { TEXTURE_PROCESS_V1, TEXTURE_EFFECT_CODE_V1, normalizeTextureParamsV1, normalizeTextureEffectV1,
	createTextureEffectV1, prepareTextureEffectV1, textureAdjustmentV1, texturePreviewPassV1,
	serializeTextureEffectToFfmpegV1, assertTextureFfmpegOperationV1 } from '../src/common/editor/video-texture-v1.ts';
import { withTexturePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-texture-v1.ts';
import { TEXTURE_GLSL_V1 } from '../src/common/editor/ui/video-preview-texture-v1.ts';

const effect=(amount=100,enabled=true)=>({id:'texture',type:'texture-v1',enabled,params:{amount}});
const limits={maximumSidePixels:32,maximumPixels:1024,maximumBytes:4096};
const frame=(pixels:Uint8Array,width:number)=>({descriptor:{schemaVersion:1,width,height:pixels.length/(width*4),sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels});

test('Texture has exact closed authored parameters, JavaScript Q8 preparation and owning process32',()=>{
	assert.equal(TEXTURE_PROCESS_V1,'srgb-alpha-binomial3-5-luma-texture-q8-v1');assert.equal(TEXTURE_EFFECT_CODE_V1,32);
	assert.deepEqual(normalizeTextureParamsV1(undefined),{amount:0});
	const raw=effect(37.125),value=normalizeTextureEffectV1(raw);raw.params.amount=-100;
	assert.equal(value.params.amount,37.125);assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.params));
	for(const amount of [-100,-50,-0.1953125,0,0.1953125,37.125,Math.PI,100]){
		const prepared=prepareTextureEffectV1(effect(amount)),expected=Math.round(amount*256/100);
		assert.equal(prepared.gainQ8,Object.is(expected,-0)?0:expected);
	}
	for(const bad of [null,[],{extra:1},{amount:undefined},{amount:NaN},{amount:Infinity},{amount:100.01},{amount:-100.01},{amount:'1'}])
		assert.throws(()=>normalizeTextureParamsV1(bad));
	let reads=0,calls=0;const accessor=Object.defineProperty({},'amount',{enumerable:true,get(){reads++;return 50;}});
	assert.throws(()=>createTextureEffectV1({params:accessor},()=>{calls++;return 'created';}));assert.equal(reads,0);assert.equal(calls,0);
	for(const bad of [{...effect(),id:'x'.repeat(129)},{...effect(),params:undefined},{...effect(),type:'texture-v2'},{...effect(),extra:1}])
		assert.throws(()=>normalizeTextureEffectV1(bad));
	assert.throws(()=>texturePreviewPassV1({...effect(),enabled:false,params:{amount:101}}));
	assert.deepEqual(createTextureEffectV1({params:{amount:50}},()=>{calls++;return 'created';}),{...effect(50),id:'created'});assert.equal(calls,1);
	assert.deepEqual(texturePreviewPassV1(effect(50)),{code:32,params0:[128,0,0,0],params1:[0,0,0,0],direction:[0,0]});
	assert.equal(texturePreviewPassV1(effect(0)),null);assert.equal(texturePreviewPassV1(effect(100,false)),null);
	const operation=serializeTextureEffectToFfmpegV1(effect());assert.ok(operation);assertTextureFfmpegOperationV1(operation);
	assert.throws(()=>assertTextureFfmpegOperationV1({...operation}));assert.equal(serializeTextureEffectToFfmpegV1(effect(0)),null);
	assert.match(TEXTURE_GLSL_V1,/texelFetch/u);assert.match(TEXTURE_GLSL_V1,/65536/u);
});

test('dual means, strong-edge gate and signed adjustment have exact independent half and bound oracles',()=>{
	const half=prepareTextureEffectV1(effect(50));
	assert.equal(textureAdjustmentV1(half,127,126,1,127,1),0,'Negative half adjustment ties toward positive infinity.');
	assert.equal(textureAdjustmentV1(half,127,128,1,127,1),1);
	assert.equal(textureAdjustmentV1(half,127,255,2,254,2),1,'Each positive blur half rounds before taking the band.');
	assert.equal(textureAdjustmentV1(half,0,255,1,128,1),0,'Strong coarse edges have no texture gain.');
	assert.throws(()=>textureAdjustmentV1({...half},127,126,1,127,1));
	const maximum3=16n*255n,maximum5=256n*255n;
	assert.equal(2n*maximum3*255n+maximum3,2084880n);assert.equal(2n*maximum5*255n+maximum5,33358080n);
	assert.equal(255n*256n*256n+32768n,16744448n);assert.ok(33358080n<2n**31n);
});

test('replicated tiny frames and medium-frequency details have literal enhancement and smoothing goldens',async()=>{
	const pixels=new Uint8Array([64,128,192].flatMap(n=>[n,n,n,255]));
	for(const [amount,expected]of [[100,[59,128,197]],[-100,[69,128,187]],[50,[62,128,195]]]as const)
		assert.deepEqual(await withTexturePixelFrameV1({frame:frame(pixels,3),effect:effect(amount)},view=>[...view.pixels],{limits}),expected.flatMap(n=>[n,n,n,255]));
	const medium=new Uint8Array(Array.from({length:4},()=>[96,128,160,128]).flat().flatMap(n=>[n,n,n,255]));
	for(const [amount,expected]of [[100,[91,128,165,128]],[-100,[101,128,155,128]],[37.125,[94,128,162,128]]]as const){
		const output=await withTexturePixelFrameV1({frame:frame(medium,16),effect:effect(amount)},view=>[...view.pixels],{limits});
		assert.deepEqual(output.slice(16,32),expected.flatMap(n=>[n,n,n,255]));
	}
});

test('flat, linear and highest-frequency interiors preserve bytes while both alpha-weighted means match independent BigInt',async()=>{
	for(const values of [Array.from({length:9},()=>128),Array.from({length:9},(_,n)=>32+n*16),Array.from({length:9},(_,n)=>n%2?136:120)]){
		const pixels=new Uint8Array(values.flatMap(n=>[n,n,n,255]));
		for(const amount of [-100,100]){
			const output=await withTexturePixelFrameV1({frame:frame(pixels,9),effect:effect(amount)},view=>[...view.pixels],{limits});
			assert.deepEqual(output.slice(8,28),[...pixels.slice(8,28)]);
		}
	}
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	for(const amount of [-100,-50,37.125,100,0]){
		const output=await withTexturePixelFrameV1({frame:frame(source,16),effect:effect(amount)},view=>[...view.pixels],{limits});
		assert.deepEqual(output,reference(source,16,amount));assert.deepEqual(output.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
	}
	const transparent=new Uint8Array([255,0,255,0,64,128,192,1,0,255,0,0]);
	assert.deepEqual(await withTexturePixelFrameV1({frame:frame(transparent,3),effect:effect()},view=>[...view.pixels],{limits}),[...transparent]);
});

/** Independent oracle uses two separate BigInt neighborhoods, rather than the
 * production coupled25-sample traversal or owning prepared/scalar helpers. */
function reference(source:Uint8Array,width:number,amount:number):number[]{
	const height=source.length/(4*width),gain=BigInt(Math.round(amount*256/100));
	const luma=(n:number)=>(54n*BigInt(source[n]!)+183n*BigInt(source[n+1]!)+19n*BigInt(source[n+2]!)+128n)/256n;
	return [...source].map((byte,offset)=>{
		const channel=offset%4,pixel=Math.floor(offset/4);if(channel===3||source[pixel*4+3]===0)return byte;
		const x=pixel%width,y=Math.floor(pixel/width),mean=(bins:readonly bigint[])=>{
			let sum=0n,weight=0n;const radius=Math.floor(bins.length/2);
			for(let row=0;row<bins.length;row++)for(let column=0;column<bins.length;column++){
				const n=4*(Math.min(height-1,Math.max(0,y+row-radius))*width+Math.min(width-1,Math.max(0,x+column-radius)));
				const w=bins[row]!*bins[column]!*BigInt(source[n+3]!);weight+=w;sum+=w*luma(n);
			}return (2n*sum+weight)/(2n*weight);
		};
		const fine=mean([1n,2n,1n]),coarse=mean([1n,4n,6n,4n,1n]),difference=luma(pixel*4)-coarse;
		const response=256n-4n*(difference<0n?-difference:difference),gate=response<0n?0n:response;
		const n=(fine-coarse)*gain*gate+32768n,delta=n<0n?-((-n+65535n)/65536n):n/65536n;
		const result=BigInt(byte)+delta;return Number(result<0n?0n:result>255n?255n:result);
	});
}
