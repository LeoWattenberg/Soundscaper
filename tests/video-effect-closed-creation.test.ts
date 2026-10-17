/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createClosedVideoEffect } from '../src/common/editor/video-effect-closed-creation.ts';
import { normalizeDetailSharpenEffectV1, normalizeDetailSharpenParamsV1 } from '../src/common/editor/video-sharpen-v1.ts';

for (const [type,name,params,message] of [
	['color-wheels-v1','color wheel creation',{shadowsHue:0,shadowsSaturation:0,shadowsLuminance:0,midtonesHue:0,midtonesSaturation:0,midtonesLuminance:0,highlightsHue:0,highlightsSaturation:0,highlightsLuminance:0},'Color wheel creation requires its exact effect type.'],
	['detail-sharpen-v1','detail sharpening creation',{amount:0,threshold:0},'Detail sharpening creation requires its exact effect type.'],
] as const) test(`closed creation extraction preserves ${type} owning defaults, errors and mutable detached results`, () => {
	const source={id:'stable',type,enabled:false,params,index:100_000},effect=createVideoEffect(type,source);
	assert.deepEqual(effect,{id:'stable',type,enabled:false,params}); assert.notStrictEqual(effect.params,source.params); assert.ok(!Object.isFrozen(effect.params));
	for(const index of [-1,100_001,NaN,0.5,'0']) assert.throws(()=>createVideoEffect(type,{id:'stable',index}),{name:'RangeError',message:'Invalid effect insertion index.'});
	assert.throws(()=>createVideoEffect(type,{type:'other'}),{name:'RangeError',message});
	let reads=0; const getter=Object.defineProperty({},'params',{enumerable:true,get(){reads++;return {};}});
	assert.throws(()=>createVideoEffect(type,getter),new RegExp(name));assert.equal(reads,0);
	for(const options of [null,[],{extra:1},{id:'x'.repeat(129)}])assert.throws(()=>createVideoEffect(type,options as unknown as Record<string,unknown>));
});

test('fixed creation profile captures both owning normalizers before caller admission or callback reentry', () => {
	let paramsCalls=0,effectCalls=0;
	const profile={name:'detail sharpening creation',typeError:'Exact type required.',normalizeParams:(_value:unknown)=>normalizeDetailSharpenParamsV1(undefined),
		normalizeEffect:(value:unknown)=>normalizeDetailSharpenEffectV1(value)};
	profile.normalizeParams=value=>{paramsCalls++;profile.normalizeEffect=()=>{throw Error('Replacement callback must not run.');};return normalizeDetailSharpenParamsV1(value);};
	const captured=profile.normalizeEffect;profile.normalizeEffect=value=>{effectCalls++;return captured(value);};
	assert.deepEqual(createClosedVideoEffect('detail-sharpen-v1',{id:'stable',params:{amount:37.125}},profile),
		{id:'stable',type:'detail-sharpen-v1',enabled:true,params:{amount:37.125,threshold:0}});
	assert.equal(paramsCalls,1);assert.equal(effectCalls,1);
});
