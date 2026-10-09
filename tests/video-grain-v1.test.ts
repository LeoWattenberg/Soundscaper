/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GRAIN_PROCESS_V1, normalizeGrainParamsV1, createGrainEffectV1, prepareGrainEffectV1, grainNoiseV1, grainOffsetV1,
	grainPreviewPassV1, serializeGrainEffectToFfmpegV1, assertGrainFfmpegOperationV1 } from '../src/common/editor/video-grain-v1.ts';

const effect=(params:unknown={},enabled=true)=>({id:'grain',type:'grain-v1',enabled,params});

test('grain owns a closed four-control deterministic natural-output recipe before ID creation',()=>{
	assert.equal(GRAIN_PROCESS_V1,'srgb-natural-output-grain-q8-v1');
	assert.deepEqual(normalizeGrainParamsV1(undefined),{amount:0,size:1,roughness:50,seed:0});
	const raw={amount:37.125,size:2.25,roughness:75,seed:65520},p=normalizeGrainParamsV1(raw);raw.size=8;
	assert.equal(p.size,2.25);assert.ok(Object.isFrozen(p));assert.equal(Object.is(normalizeGrainParamsV1({seed:-0}).seed,-0),false);
	for(const params of [null,{future:1},{amount:undefined},{amount:'50'},{amount:NaN},{amount:100.01},{size:0.999},{size:8.001},
		{roughness:-1},{roughness:Infinity},{seed:0.5},{seed:65521},{seed:-1}])assert.throws(()=>normalizeGrainParamsV1(params));
	let calls=0,reads=0;const factory=()=>{calls++;return'created';};
	const accessor=Object.defineProperty({},'amount',{enumerable:true,get(){reads++;return 50;}});
	assert.throws(()=>createGrainEffectV1({params:accessor},factory));assert.equal(reads,0);assert.equal(calls,0);
	assert.throws(()=>createGrainEffectV1({params:{seed:0.1}},factory));assert.equal(calls,0);
	assert.deepEqual(createGrainEffectV1({params:{amount:100,seed:23}},factory),{...effect({amount:100,size:1,roughness:50,seed:23}),id:'created'});
	assert.equal(calls,1);
});

test('both lattice octaves and signed half-up interpolation match an independent BigInt recipe',()=>{
	for(const params of [{amount:100,size:1,roughness:0,seed:0},{amount:37.125,size:1,roughness:100,seed:65520},
		{amount:100,size:1.00390625,roughness:49.8,seed:19},{amount:100,size:8,roughness:50,seed:12345}]){
		const p=prepareGrainEffectV1(effect(params));
		for(const x of [0,1,2,7,255,65534,65535])for(const y of [0,3,127,65535]){
			const expected=referenceNoise(x,y,params);assert.equal(grainNoiseV1(p,x,y),expected);
			for(const rgb of [[0,0,0],[255,255,255],[8,128,250],[128,128,128],[255,0,128]] as const)
				assert.equal(grainOffsetV1(p,rgb[0],rgb[1],rgb[2],expected),referenceOffset(rgb,expected,params.amount));
		}
	}
	const p=prepareGrainEffectV1(effect({amount:100}));
	assert.throws(()=>grainNoiseV1({...p},0,0));assert.throws(()=>grainNoiseV1(p,65536,0));assert.throws(()=>grainNoiseV1(p,0,-1));
	assert.throws(()=>grainOffsetV1(p,0,0,256,0));assert.throws(()=>grainOffsetV1(p,0,0,0,129));
});

test('uint center/hash products and signed interpolation/midtone additions have explicit exact bounds',()=>{
	const unsigned=2n**32n-1n,signed=2n**31n-1n;
	assert.equal(131071n*32768n,4294934528n);assert.ok(131071n*32768n<unsigned);
	assert.equal(65520n*65520n+31n*65520n+17n,4294901537n);assert.ok(4294901537n<unsigned);
	assert.equal(131072n*73n+131072n*151n+65520n*199n+101n,42398709n);assert.ok(42398709n<unsigned);
	assert.ok(128n*65536n+32768n<signed);assert.ok(128n*256n*254n+131072n<signed);
	const p=prepareGrainEffectV1(effect({amount:100}));
	assert.equal(grainOffsetV1(p,128,128,128,128),32);assert.equal(grainOffsetV1(p,128,128,128,-128),-32);
	assert.equal(grainOffsetV1(p,0,0,0,128),0);assert.equal(grainOffsetV1(p,255,255,255,-128),0);
	assert.equal(grainOffsetV1(p,2,2,2,-128),0,'Negative half tie rounds toward positive infinity.');
	assert.equal(grainOffsetV1(p,2,2,2,128),1);
});

test('size, roughness and seed stay active without clock or cached preview tables',()=>{
	const values=(params:unknown)=>{const p=prepareGrainEffectV1(effect(params));return Array.from({length:24},(_,x)=>grainNoiseV1(p,x,5));};
	assert.notDeepEqual(values({amount:100,size:1,roughness:0}),values({amount:100,size:8,roughness:0}));
	assert.notDeepEqual(values({amount:100,size:1,roughness:100}),values({amount:100,size:8,roughness:100}));
	assert.notDeepEqual(values({amount:100,size:4,roughness:0}),values({amount:100,size:4,roughness:100}));
	assert.notDeepEqual(values({amount:100,seed:0}),values({amount:100,seed:1}));assert.deepEqual(values({amount:100,seed:7}),values({amount:100,seed:7}));
	assert.equal(grainPreviewPassV1(effect()),null);assert.equal(grainPreviewPassV1(effect({amount:100},false)),null);
	assert.throws(()=>grainPreviewPassV1(effect({seed:65521},false)));
	assert.deepEqual(grainPreviewPassV1(effect({amount:37.125,size:2.25,roughness:75,seed:23})),
		{code:31,params0:[95,576,192,23],params1:[0,0,0,0],direction:[0,0]});
	const operation=serializeGrainEffectToFfmpegV1(effect({amount:100}));assert.ok(operation);assertGrainFfmpegOperationV1(operation);
	assert.throws(()=>assertGrainFfmpegOperationV1({...operation}));assert.equal(serializeGrainEffectToFfmpegV1(effect()),null);
});

function floor(n:bigint,d:bigint):bigint{return n<0n?-((-n+d-1n)/d):n/d;}
function referenceNoise(x:number,y:number,p:{size:number;roughness:number;seed:number}):number{
	const size=BigInt(Math.round(p.size*256)),rough=BigInt(Math.round(p.roughness*256/100));
	const sample=(cx:bigint,cy:bigint)=>{
		let h=(cx*73n+cy*151n+BigInt(p.seed)*199n+101n)%65521n;h=(h*h+31n*h+17n)%65521n;
		const first=h%257n;h=(h*h+31n*h+17n)%65521n;return floor(first+h%257n-255n,2n);
	};
	const octave=(spacing:bigint)=>{
		const qx=BigInt(2*x+1)*32768n/spacing,qy=BigInt(2*y+1)*32768n/spacing,ix=qx/256n,iy=qy/256n,fx=qx%256n,fy=qy%256n;
		return floor(sample(ix,iy)*(256n-fx)*(256n-fy)+sample(ix+1n,iy)*fx*(256n-fy)
			+sample(ix,iy+1n)*(256n-fx)*fy+sample(ix+1n,iy+1n)*fx*fy+32768n,65536n);
	};
	return Number(floor(octave(size)*(256n-rough)+octave(size/2n)*rough+128n,256n));
}
function referenceOffset(rgb:readonly number[],noise:number,amount:number):number{
	const luma=(54n*BigInt(rgb[0]!)+183n*BigInt(rgb[1]!)+19n*BigInt(rgb[2]!)+128n)/256n,response=2n*(luma<255n-luma?luma:255n-luma);
	return Number(floor(BigInt(noise)*BigInt(Math.round(amount*256/100))*response+131072n,262144n));
}
