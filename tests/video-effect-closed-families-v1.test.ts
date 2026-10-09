/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { CLOSED_VIDEO_EFFECT_DEFINITIONS_V1, isClosedVideoEffectTypeV1, hasClosedVideoEffectEnvelopeV1,
	normalizeClosedVideoEffectParamsV1, normalizeClosedVideoEffectV1, createClosedVideoEffectFamilyV1,
	serializeClosedVideoEffectV1 } from '../src/common/editor/video-effect-closed-families-v1.ts';
import { VIDEO_EFFECT_TYPES, VIDEO_EFFECT_V5_TYPES, videoEffectDefinition, videoEffectDefaults, validateVideoEffectParams,
	createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendDetailSharpenFfmpegOperationV1 } from '../src/common/editor/video-sharpen-ffmpeg-v1.ts';
import { appendPostCropVignetteFfmpegOperationV1 } from '../src/common/editor/video-post-crop-vignette-ffmpeg-v1.ts';
import { appendClarityFfmpegOperationV1 } from '../src/common/editor/video-clarity-ffmpeg-v1.ts';
import { EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';

const TYPES=['white-balance-v1','tone-ladder-v1','develop-geometry-v1','chroma-v1','black-white-mix-v1','hsl-mixer-v1',
	'point-curves-v1','parametric-curves-v1','color-wheels-v1','detail-sharpen-v1','post-crop-vignette-v1','clarity-v1','noise-reduction-v1','grain-v1','texture-v1','dehaze-v1'] as const;
const ENVELOPES=['color-wheels-v1','detail-sharpen-v1','post-crop-vignette-v1','clarity-v1','noise-reduction-v1','grain-v1','texture-v1','dehaze-v1'];

test('fixed closed family ownership retains the old inventory and appends exact Noise, Grain, Texture and Dehaze registrations',()=>{
	assert.deepEqual(Object.keys(CLOSED_VIDEO_EFFECT_DEFINITIONS_V1),TYPES);assert.ok(Object.isFrozen(CLOSED_VIDEO_EFFECT_DEFINITIONS_V1));
	assert.deepEqual(VIDEO_EFFECT_TYPES.slice(12),TYPES);assert.equal(VIDEO_EFFECT_TYPES.length,28);assert.equal(EFFECT_PROGRAM_COUNT,34);
	assert.deepEqual(VIDEO_EFFECT_V5_TYPES,['color-adjust','pixelate','vignette','gaussian-blur','sharpen','rgb-split']);
	for(const type of TYPES){assert.equal(isClosedVideoEffectTypeV1(type),true);assert.equal(hasClosedVideoEffectEnvelopeV1(type),ENVELOPES.includes(type));
		assert.equal(CLOSED_VIDEO_EFFECT_DEFINITIONS_V1[type],videoEffectDefinition(type));}
	let reads=0;const hostile={toString(){reads++;return'clarity-v1';}};
	for(const value of [hostile,'__proto__','constructor','color-adjust','noise-reduction-v2','grain-v2','clarity-v2'])assert.equal(isClosedVideoEffectTypeV1(value),false);
	assert.equal(reads,0);assert.throws(()=>normalizeClosedVideoEffectParamsV1('__proto__',{}));
});

test('all existing default/label/option/recipe/operation bytes equal the pre-extraction24-family capture',()=>{
	const output=VIDEO_EFFECT_TYPES.slice(0,24).map(type=>{
		const params=videoEffectDefaults(type),first=Object.entries(videoEffectDefinition(type).params as Record<string,{default:unknown;step:number;max:number}>).find(([,p])=>typeof p.default==='number'&&p.default+p.step<=p.max);
		if(first && typeof first[1].default==='number'){const[key,p]=first;params[key]=first[1].default+p.step;}
		if(type==='develop-geometry-v1')Object.assign(params,{cropX:0,rotationDegrees:0.01});
		if(type==='point-curves-v1')params.master=[{x:0,y:1},{x:1,y:0}];
		const effect=createVideoEffect(type,{id:'compat',params});
		return{type,definition:videoEffectDefinition(type),defaults:videoEffectDefaults(type),effect,normalized:normalizeVideoEffect(effect),
			operations:serializeVideoEffectsToFfmpegOperations([effect]),disabled:serializeVideoEffectsToFfmpegOperations([{...effect,enabled:false}])};
	});
	const serialized=JSON.stringify(output);assert.equal(Buffer.byteLength(serialized),128009);
	assert.equal(createHash('sha256').update(serialized).digest('hex'),'33b05b22ed0fc033f001526a9ced43a6e35c00ed72f72779f9edc18d638caa55');
});

test('fixed callbacks retain detached fractional and curve values with owning export identities',()=>{
	for(const type of TYPES){
		const effect=createVideoEffect(type,{id:'fixed'}),params=normalizeClosedVideoEffectParamsV1(type,effect.params);
		assert.deepEqual(params,effect.params);assert.notEqual(params,effect.params);
		assert.deepEqual(normalizeClosedVideoEffectV1(type,effect),normalizeVideoEffect(effect));
		assert.deepEqual(serializeClosedVideoEffectV1(type,effect),serializeVideoEffectsToFfmpegOperations([effect]));
	}
	const params={shadowsHue:13.25,highlightsLuminance:-37.125},created=createClosedVideoEffectFamilyV1('color-wheels-v1',{id:'wheel',params});
	assert.ok(created);params.shadowsHue=0;assert.equal(created.params.shadowsHue,13.25);assert.equal(created.params.highlightsLuminance,-37.125);
	assert.equal(Object.isFrozen(created),false);assert.equal(Object.isFrozen(created.params),false);
	assert.equal(createClosedVideoEffectFamilyV1('tone-ladder-v1',{}),null,'Older wrapper creation remains in the legacy owner.');
});

test('fixed routing preserves owning graph labels and the existing private vignette operation identity',()=>{
	for(const [type,append] of [['detail-sharpen-v1',appendDetailSharpenFfmpegOperationV1],
		['post-crop-vignette-v1',appendPostCropVignetteFfmpegOperationV1],['clarity-v1',appendClarityFfmpegOperationV1]] as const){
		const effect=createVideoEffect(type,{id:'compiled',params:{amount:50}}),[operation]=serializeVideoEffectsToFfmpegOperations([effect]);
		assert.ok(operation);const filters:string[]=[];append({filters,inputLabel:'original',outputLabel:'next',operation});
		assert.equal(filters.length,7);assert.match(filters.at(-1)!,/\[next\]$/u);
		const rejected:string[]=[];const refused=type==='post-crop-vignette-v1'?{...operation}:{...operation,kind:'foreign'};
		assert.throws(()=>append({filters:rejected,inputLabel:'original',outputLabel:'next',operation:refused}));
		assert.deepEqual(rejected,[]);
	}
});

test('closed options and complete envelopes refuse accessors, extra fields and disabled malformed values',()=>{
	for(const type of ENVELOPES){
		const valid=createVideoEffect(type,{id:'closed'});let reads=0;
		const accessor=Object.defineProperty({},'enabled',{enumerable:true,get(){reads++;return false;}});
		for(const options of [accessor,{future:1},{type:'clarity-v2'},{enabled:null},{index:0.5},{index:-1}])assert.throws(()=>createVideoEffect(type,options));
		for(const effect of [{...valid,future:1},{...valid,enabled:false,params:{future:0}},{...valid,id:'x'.repeat(129)}])assert.throws(()=>normalizeVideoEffect(effect));
		assert.equal(reads,0);assert.throws(()=>normalizeVideoEffect(valid,'restricted',{allowedTypes:VIDEO_EFFECT_V5_TYPES}),/restricted\.type is not supported by this schema\./u);
	}
});

test('older versioned wrapper prechecks and legacy permissive identity/options remain byte-compatible',()=>{
	for(const type of TYPES.filter(type=>!ENVELOPES.includes(type))){
		assert.throws(()=>normalizeVideoEffect({...createVideoEffect(type,{id:'older'}),future:1},'older'),/older\.future is not supported\./u);
		assert.throws(()=>normalizeVideoEffect({...createVideoEffect(type,{id:'older'}),enabled:false,params:{future:1}}));
		assert.throws(()=>normalizeVideoEffect(createVideoEffect(type,{id:'older'}),'older',{allowedTypes:VIDEO_EFFECT_V5_TYPES}),new RegExp(`older\\.type is not supported by this schema: ${type}\\.`,'u'));
		assert.throws(()=>normalizeVideoEffect(Object.defineProperty({},'type',{get(){assert.fail('No borrowed type accessor');}}),'older'),/older\.type requires a data field\./u);
	}
	let reads=0;const inherited=Object.create({enabled:true}) as {enabled:boolean};
	Object.defineProperty(inherited,'id',{enumerable:true,value:'x'.repeat(129)});Object.assign(inherited,{params:{blockSize:2.5},future:1});
	assert.throws(()=>createVideoEffect('pixelate',inherited),/integer/u);Object.assign(inherited,{params:{blockSize:2}});
	assert.equal(createVideoEffect('pixelate',inherited).id.length,129);
	const scalar=Object.defineProperty({},'temperature',{enumerable:true,get(){reads++;return 25;}});
	assert.throws(()=>validateVideoEffectParams('white-balance-v1',scalar));assert.equal(reads,0);
});
