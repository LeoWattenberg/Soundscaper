/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { HSL_MIXER_PROCESS_V1, HSL_MIXER_GLSL_V1, normalizeHslMixerEffectV1, prepareHslMixerEffectV1,
	applyHslMixerPixelV1, hslMixerPreviewPassV1 } from '../src/common/editor/video-hsl-mixer-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const COLORS=['red','orange','yellow','green','aqua','blue','purple','magenta'];
const CENTERS=[[254,0,0],[254,127,0],[254,254,0],[0,254,0],[0,254,254],[0,0,254],[127,0,254],[254,0,254]];
const ROTATED=[[254,254,0],[127,254,0],[0,254,0],[0,254,254],[0,0,254],[254,0,254],[254,0,127],[254,0,0]];
const effect=(params={},enabled=true)=>({id:'hsl',type:'hsl-mixer-v1',enabled,params});
const all=(suffix:string,value:number)=>Object.fromEntries(COLORS.map(color=>[`${color}${suffix}`,value]));
function render(params={},source= CENTERS.flatMap((rgb,i)=>[...rgb,[0,1,127,255][i%4]!]),enabled=true){
	const prepared=prepareHslMixerEffectV1(effect(params,enabled)),pixels=new Uint8Array(source);
	for(let i=0;i<pixels.length;i+=4)applyHslMixerPixelV1(prepared,pixels,i);
	return [...pixels];
}

test('GLSL hue remainder receives only nonnegative admitted integers, including the native negative-red regression',()=>{
	// Native WebKit produced cyan/blue for red -37.125 degrees. GLSL does
	// not define signed remainder with a negative operand.
	const expression=/int phase=\(hsl_nearest\(n\*65536,c\)\+hue(?:\+(\d+))?\)%393216/.exec(HSL_MIXER_GLSL_V1);
	assert.ok(expression);const offset=Number(expression[1]??0),Q=65536,period=6*Q;
	for(const sourcePhase of [0,1,period-1])for(const hue of [-3*Q,-40550,0,3*Q]){
		const dividend=sourcePhase+hue+offset;
		assert.ok(dividend>=0&&dividend<2**31,'GLSL signed remainder requires a nonnegative dividend');
		assert.equal(dividend%period,((sourcePhase+hue)%period+period)%period);
	}
	assert.equal((offset-40550)%period,352666);
});

test('enabled neutral and disabled HSL retain every byte, including all256 alpha and hidden RGB',()=>{
	assert.equal(HSL_MIXER_PROCESS_V1,'srgb-hsl-hue-q16-v1');
	const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat();
	assert.deepEqual(render({},source),source);assert.deepEqual(render(all('Hue',180),source,false),source);
	assert.equal(prepareHslMixerEffectV1(effect()).neutral,true);assert.equal(hslMixerPreviewPassV1(effect()),null);
	assert.equal(hslMixerPreviewPassV1(effect({redHue:60}))?.code,23);
});

test('eight independently stated hue knots own their controls and wrap around magenta/red',()=>{
	for(const [index,color]of COLORS.entries()){
		const expected=CENTERS.map((rgb,i)=>i===index?ROTATED[i]!:rgb);
		assert.deepEqual(render({[`${color}Hue`]:60}),expected.flatMap((rgb,i)=>[...rgb,[0,1,127,255][i%4]!]));
	}
	assert.deepEqual(render({redHue:180},[255,0,0,0]),[0,255,255,0]);
	assert.deepEqual(render({redHue:-180},[255,0,0,1]),[0,255,255,1]);
	assert.deepEqual(render({redHue:73.25},[255,0,0,127]),[199,255,0,127]);
	assert.deepEqual(render({redHue:-37.125},[255,0,0,255]),[255,0,158,255]);
});

test('HSL saturation/lightness clipping and signed half-up ties have independent byte goldens',()=>{
	const source=[64,128,192,127];
	assert.deepEqual(render(all('Saturation',-100),source),[128,128,128,127]);
	assert.deepEqual(render(all('Saturation',100),source),[1,128,255,127]);
	assert.deepEqual(render(all('Luminance',50),source),[160,192,224,127]);
	assert.deepEqual(render(all('Luminance',-50),source),[32,64,97,127]);
	assert.deepEqual(render({redLuminance:50},[255,0,0,1]),[255,128,128,1]);
	assert.deepEqual(render({redLuminance:-50},[255,0,0,1]),[128,0,0,1]);
	assert.deepEqual(render({redSaturation:-100},[1,0,0,0]),[1,1,1,0]);
	assert.deepEqual(render({redLuminance:100},[255,0,0,255]),[255,255,255,255]);
	assert.deepEqual(render({redLuminance:-100},[255,0,0,255]),[0,0,0,255]);
	assert.deepEqual(render({redHue:73.25,redSaturation:-37.125,redLuminance:33.3},[255,0,0,127]),[200,224,117,127]);
});

test('all gray values are invariant and prepared controls detach/freeze without a second recipe',()=>{
	const source=Array.from({length:256},(_,n)=>[n,n,n,n]).flat();
	assert.deepEqual(render({...all('Hue',180),...all('Saturation',100),...all('Luminance',100)},source),source);
	const raw=effect({redHue:73.25,redSaturation:-37.125,redLuminance:33.3}),prepared=prepareHslMixerEffectV1(raw);
	assert.equal(Reflect.set(raw.params,'redHue',0),true);assert.equal(prepared.params0[0],80009);
	for(const tuple of [prepared.params0,prepared.params1,prepared.params2,prepared.params3,prepared.params4,prepared.params5])assert.ok(Object.isFrozen(tuple));
	assert.ok(Object.isFrozen(prepared));
});

test('all256 mixed RGB/alpha values match an independent rational BigInt HSL implementation',()=>{
	const source=Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat();
	for(const controls of [[180,-180,73.25,-37.125,12.5,0,120,-60,100,-100,33.3,-73.25,12.5,-37.125,50,0,100,-100,33.3,-73.25,12.5,-37.125,50,0],
		[0,0,0,0,0,0,0,0,100,50,0,-50,-100,25,-25,12.5,100,50,0,-50,-100,25,-25,33.3]]){
		const params=Object.fromEntries(['Hue','Saturation','Luminance'].flatMap((suffix,group)=>COLORS.map((color,i)=>[`${color}${suffix}`,controls[group*8+i]!]))),expected:number[]=[];
		for(let i=0;i<source.length;i+=4)expected.push(...reference(source.slice(i,i+3),controls),source[i+3]!);
		assert.deepEqual(render(params,source),expected);
	}
});

test('closed owning admission rejects accessors, future fields, invalid controls and long IDs',()=>{
	let reads=0;const accessor=Object.defineProperty({},'redHue',{enumerable:true,get(){reads++;return 0;}});
	for(const input of [{...effect(),future:0},{...effect(),type:'hsl-mixer-v2'},{...effect(),id:'x'.repeat(129)},
		{...effect(),enabled:0},effect({redHue:180.01}),effect({blueSaturation:-100.01}),effect({purpleLuminance:NaN}),effect({future:0}),effect(accessor)])assert.throws(()=>normalizeHslMixerEffectV1(input));
	assert.equal(reads,0);const normalized=normalizeHslMixerEffectV1(effect());assert.equal(Object.keys(normalized.params).length,24);assert.ok(Object.isFrozen(normalized.params));
});

test('actual photo proxy shares HSL pixels and measures only visible rendered samples',async()=>{
	const pixels=new Uint8Array([255,0,0,0,255,0,0,1,64,128,192,127]),source=[...pixels];
	let retained:Uint8Array|null=null;
	const output=await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects:[createVideoEffect('hsl-mixer-v1',{params:{redHue:73.25,redSaturation:-37.125,redLuminance:33.3}})]}},view=>{
		retained=view.frame.pixels;return {pixels:[...view.frame.pixels],histogram:view.histogram};
	});
	assert.deepEqual(output.pixels,[200,224,117,0,200,224,117,1,64,128,192,127]);
	assert.equal(output.histogram.transparentPixels,1);assert.equal(output.histogram.sampledPixels,2);assert.equal(output.histogram.bins.red[200],1);
	assert.deepEqual([...pixels],source);assert.ok((retained as Uint8Array|null)?.every(value=>value===0));
});

test('yielding HSL snapshots native bytes/settings and preserves opaque cancellation through joined cleanup',async()=>{
	const limits={maximumSidePixels:512,maximumPixels:131072,maximumBytes:524288};
	const descriptor={schemaVersion:1,width:512,height:256,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'};
	const bytes=()=>new Uint8Array(Array.from({length:131072},()=>[255,0,0,127]).flat());
	const source=bytes(),raw=effect({redHue:60});
	const timer=setTimeout(()=>{structuredClone(source.buffer,{transfer:[source.buffer]});Reflect.set(raw.params,'redHue',0);},0);
	try{
		const result=await withGlobalDevelopPixelFrameV1({frame:{descriptor,pixels:source},effects:[raw]},view=>[...view.pixels],{limits});
		assert.equal(source.byteLength,0);assert.equal(result.length,524288);assert.ok(result.every((value,i)=>value===([255,255,0,127][i%4])));
	}finally{clearTimeout(timer);}
	let traps=0,consumed=false;
	const stop=new AbortController(),reason=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();}});
	Object.defineProperty(stop.signal,'throwIfAborted',{get(){traps++;throw Error();}});
	const cancel=setTimeout(()=>{stop.abort(reason);},0);
	try{
		const result=await withGlobalDevelopPixelFrameV1({frame:{descriptor,pixels:bytes()},effects:[effect({redHue:60})],signal:stop.signal},()=>{consumed=true;},{limits})
			.then(()=>({reason:undefined as unknown}),failure=>({reason:failure as unknown}));
		assert.equal(result.reason,reason);assert.equal(consumed,false);assert.equal(traps,0);
	}finally{clearTimeout(cancel);}
});

// Independent exact rational HSL reference: no production classifier, tables or pixel kernel.
function reference(rgb:number[],controls:number[]):number[]{
	const Q=65536n,v=rgb.map(BigInt),max=v.reduce((a,b)=>a>b?a:b),min=v.reduce((a,b)=>a<b?a:b),c=max-min;if(c===0n)return rgb;
	let n=max===v[0]?v[1]!-v[2]!:max===v[1]?v[2]!-v[0]!+2n*c:v[0]!-v[1]!+4n*c;if(n<0n)n+=6n*c;
	const h=(n*512n+c)/(2n*c),centers=[0n,128n,256n,512n,768n,1024n,1152n,1280n,1536n],left=centers.findIndex((_,i)=>i<8&&h<centers[i+1]!);
	const coefficients=controls.map((value,i)=>BigInt(Math.round(value/(i<8?60:100)*65536))),width=centers[left+1]!-centers[left]!,distance=h-centers[left]!;
	const interpolate=(group:number)=>{const a=coefficients[group*8+left]!,z=coefficients[group*8+(left+1)%8]!;return a+nearest((z-a)*distance,width);};
	const hue=interpolate(0),sat=interpolate(1),lum=interpolate(2),l=max+min,d=255n-abs(l-255n);
	const saturated=clamp(nearest(c*(Q+sat),Q),0n,d),nextL=l+nearest((lum>=0n?510n-l:l)*lum,Q),nextD=255n-abs(nextL-255n);
	const nextC=clamp(nearest(saturated*nextD,d),0n,nextD),base=nextL-nextC;
	if(hue===0n)return v.map(channel=>Number(clamp(nearest(base*c+2n*nextC*(channel-min),2n*c),0n,255n)));
	const phase=((nearest(n*Q,c)+hue)%(6n*Q)+6n*Q)%(6n*Q),sector=Number(phase/Q),x=nextC*(Q-abs(phase%(2n*Q)-Q)),top=nextC*Q;
	const channels=[[top,x,0n],[x,top,0n],[0n,top,x],[0n,x,top],[x,0n,top],[top,0n,x]][sector]!;
	return channels.map(channel=>Number(clamp(nearest(base*Q+2n*channel,2n*Q),0n,255n)));
}
function nearest(n:bigint,d:bigint):bigint{const value=2n*n+d;return value>=0n?value/(2n*d):-((-value+2n*d-1n)/(2n*d));}
function abs(n:bigint):bigint{return n<0n?-n:n;}
function clamp(n:bigint,low:bigint,high:bigint):bigint{return n<low?low:n>high?high:n;}
