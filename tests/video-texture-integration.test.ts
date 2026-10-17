/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, VIDEO_EFFECT_TYPES, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { CLOSED_VIDEO_EFFECT_DEFINITIONS_V1, normalizeClosedVideoEffectParamsV1, createClosedVideoEffectFamilyV1 } from '../src/common/editor/video-effect-closed-families-v1.ts';
import { EFFECT_CODES, EFFECT_PROGRAM_COUNT, videoEffectPasses } from '../src/common/editor/ui/video-preview-effects.js';
import { assertTextureFfmpegOperationV1 } from '../src/common/editor/video-texture-v1.ts';
import { assertGrainFfmpegOperationV1 } from '../src/common/editor/video-grain-v1.ts';
import { isCompiledNoiseReductionOperationV1 } from '../src/common/editor/video-noise-reduction-ffmpeg-v1.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyFrameV1, withPhotoDevelopFullResolutionFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { grainReferenceV1 } from './helpers/video-grain-reference.ts';
import { textureReferenceV1 } from './browser/helpers/lightscaper-texture-reference.ts';

test('Texture appends one exact closed family while preserving Grain and Noise private compiled ownership',()=>{
	assert.deepEqual(VIDEO_EFFECT_TYPES.slice(-4),['noise-reduction-v1','grain-v1','texture-v1','dehaze-v1']);
	assert.equal(VIDEO_EFFECT_TYPES.length,28);assert.equal(Object.keys(CLOSED_VIDEO_EFFECT_DEFINITIONS_V1).length,16);
	assert.equal(EFFECT_PROGRAM_COUNT,34);assert.equal(EFFECT_CODES['noise-reduction-v1'],30);assert.equal(EFFECT_CODES['grain-v1'],31);assert.equal(EFFECT_CODES['texture-v1'],32);
	const raw={amount:73.25},effect=createClosedVideoEffectFamilyV1('texture-v1',{id:'fixed',params:raw});assert.ok(effect);raw.amount=0;
	assert.equal(effect.params.amount,73.25);assert.deepEqual(normalizeVideoEffect(effect),effect);
	assert.deepEqual(normalizeClosedVideoEffectParamsV1('texture-v1',effect.params),{amount:73.25});
	assertTextureFfmpegOperationV1(serializeVideoEffectsToFfmpegOperations([effect])[0]);
	assertGrainFfmpegOperationV1(serializeVideoEffectsToFfmpegOperations([createVideoEffect('grain-v1',{params:{amount:100}})])[0]);
	assert.equal(isCompiledNoiseReductionOperationV1(serializeVideoEffectsToFfmpegOperations([createVideoEffect('noise-reduction-v1',{params:{color:100}})])[0]),true);
	assert.deepEqual(videoEffectPasses(undefined),[]);assert.deepEqual(videoEffectPasses(null),[]);
});

test('mixed Grain Texture and invert stages retain independently ordered alpha-aware bytes in Frame and both fixed Photo profiles',async()=>{
	const original=Array.from({length:16},(_,n)=>[n*17,255-n*17,n%2?224:32,n*17]).flat(),pixels=new Uint8Array(original);
	const grain={amount:100,size:2.25,roughness:49.8,seed:7},texture={amount:73.25};
	const effects=[createVideoEffect('grain-v1',{id:'grain',params:grain}),createVideoEffect('texture-v1',{id:'texture',params:texture}),
		createVideoEffect('point-curves-v1',{id:'invert',params:{master:[{x:0,y:1},{x:1,y:0}]}})];
	for(const reverse of [false,true]){
		const ordered=reverse?[...effects].reverse():effects;
		let expected=[...original];
		for(const effect of ordered)expected=effect.type==='grain-v1'?grainReferenceV1(expected,4,grain)
			:effect.type==='texture-v1'?textureReferenceV1(expected,4,texture.amount):expected.map((byte,n)=>n%4===3?byte:255-byte);
		const rendered=await applyVideoExactBrowserEffectsFinishing({width:4,height:4,pixels},ordered,new AbortController().signal);
		try{assert.deepEqual([...rendered.pixels],expected);}finally{rendered.pixels.fill(0);}
		for(const render of [withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1]){
			let borrowed:Uint8Array|undefined;
			const actual=await render({frame:{descriptor:{schemaVersion:1,width:4,height:4,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
				develop:{...defaultPhotoDevelopV1(),effects:ordered}},view=>{borrowed=view.frame.pixels;return[...view.frame.pixels];});
			assert.deepEqual(actual,expected);assert.ok(borrowed?.every(byte=>byte===0));
		}
		assert.deepEqual(expected.filter((_,n)=>n%4===3),Array.from({length:16},(_,n)=>n*17));assert.deepEqual([...pixels],original);
	}
});
