/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, videoEffectDefinition, VIDEO_EFFECT_TYPES, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { CLOSED_VIDEO_EFFECT_DEFINITIONS_V1 } from '../src/common/editor/video-effect-closed-families-v1.ts';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { assertGrainFfmpegOperationV1 } from '../src/common/editor/video-grain-v1.ts';
import { isCompiledNoiseReductionOperationV1 } from '../src/common/editor/video-noise-reduction-ffmpeg-v1.ts';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyFrameV1, withPhotoDevelopFullResolutionFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const params = { amount:100, size:2, roughness:0, seed:7 };
const source = () => new Uint8Array(Array.from({ length:8 }, () => [128,128,128,127]).flat());
const gray = (values:readonly number[]) => values.flatMap(value => [value,value,value,127]);
const expected = gray([124,128,128,123,125,134,140,142]);
const grain = () => createVideoEffect('grain-v1', { id:'grain', params });
const descriptor = (width:number) => ({ schemaVersion:1, width, height:1, sampleFormat:'unorm8', primaries:'srgb', transfer:'srgb' });

test('shared Grain registration adds one closed family and private export operation after Noise without replacing legacy types', () => {
	const effect = grain(); assert.deepEqual(normalizeVideoEffect(effect), effect);
	assert.equal(VIDEO_EFFECT_TYPES.length,28); assert.equal(Object.keys(CLOSED_VIDEO_EFFECT_DEFINITIONS_V1).length,16);
	assert.equal(EFFECT_PROGRAM_COUNT,34); assert.equal(EFFECT_CODES['noise-reduction-v1'],30); assert.equal(EFFECT_CODES['grain-v1'],31);
	assert.deepEqual(Object.keys(videoEffectDefinition('grain-v1').params),['amount','size','roughness','seed']);
	assert.deepEqual(videoEffectPasses(effect),[{code:31,params0:[256,512,0,7],params1:[0,0,0,0],direction:[0,0]}]);
	const operation = serializeVideoEffectsToFfmpegOperations([effect])[0]; assert.ok(operation); assertGrainFfmpegOperationV1(operation);
	const filters:string[] = []; appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'grain',operation,width:8,height:1});
	assert.equal(filters.length,7); const before = [...filters];
	assert.throws(() => appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'forged',operation:{...operation},width:8,height:1}));
	assert.deepEqual(filters,before);
	const noise = createVideoEffect('noise-reduction-v1',{id:'noise',params:{color:100}});
	assert.equal(isCompiledNoiseReductionOperationV1(serializeVideoEffectsToFfmpegOperations([noise])[0]),true);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([createVideoEffect('grain-v1'),{...effect,enabled:false}]),[]);
	for(const invalid of [{seed:0.5},{seed:65521},{amount:101},{size:0.5},{roughness:NaN},{future:1}])
		assert.throws(() => createVideoEffect('grain-v1',{enabled:false,params:invalid}));
	let reads=0; const bad=Object.defineProperty({},'seed',{enumerable:true,get(){reads++;throw Error();}});
	assert.throws(() => createVideoEffect('grain-v1',{params:bad})); assert.equal(reads,0);
});

test('actual Frame and both fixed Photo profiles render independent literal Grain bytes and retire only borrowed output', async () => {
	const pixels=source(),effect=grain();
	const frame=await applyVideoExactBrowserEffectsFinishing({width:8,height:1,pixels},[effect],new AbortController().signal);
	try { assert.deepEqual([...frame.pixels],expected); } finally { frame.pixels.fill(0); }
	for(const render of [withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1]) {
		let borrowed:Uint8Array|undefined;
		assert.deepEqual(await render({frame:{descriptor:descriptor(8),pixels},develop:{...defaultPhotoDevelopV1(),effects:[effect]}},view=>{
			borrowed=view.frame.pixels; assert.equal(view.histogram.sampledPixels,8); assert.equal(view.histogram.transparentPixels,0);
			return [...view.frame.pixels];
		}),expected); assert.ok(borrowed?.every(byte=>byte===0));
	}
	assert.deepEqual([...pixels],[...source()]);
});

test('crop and Grain use current natural-output centers in authored order rather than source or viewport coordinates', async () => {
	const pixels=source(),effect=grain(),crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropX:0.5,cropWidth:0.5}});
	const render=(effects:readonly unknown[])=>withPhotoDevelopProxyFrameV1({frame:{descriptor:descriptor(8),pixels},develop:{...defaultPhotoDevelopV1(),effects}},
		view=>({width:view.frame.descriptor.width,pixels:[...view.frame.pixels]}));
	assert.deepEqual(await render([crop,effect]),{width:4,pixels:gray([124,128,128,123])});
	assert.deepEqual(await render([effect,crop]),{width:4,pixels:gray([125,134,140,142])});
	assert.deepEqual([...pixels],[...source()]);
});

test('persisted Grain then invert-curve rendering keeps per-stage byte quantization and exact original alpha', async () => {
	const pixels=source(),effects=[grain(),createVideoEffect('point-curves-v1',{id:'invert',params:{master:[{x:0,y:1},{x:1,y:0}]}})];
	const literal=gray([131,127,127,132,130,121,115,113]);
	const frame=await applyVideoExactBrowserEffectsFinishing({width:8,height:1,pixels},effects,new AbortController().signal);
	try { assert.deepEqual([...frame.pixels],literal); } finally { frame.pixels.fill(0); }
	assert.deepEqual(await withPhotoDevelopProxyFrameV1({frame:{descriptor:descriptor(8),pixels},develop:{...defaultPhotoDevelopV1(),effects}},view=>[...view.frame.pixels]),literal);
	assert.deepEqual([...pixels],[...source()]);
});

test('Photo Grain consumer scope joins opaque native cancellation before retiring the delivered backing', async () => {
	const pixels=source(),stop=new AbortController(),entered=deferred<void>(),release=deferred<void>(); let borrowed:Uint8Array|undefined,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	const pending=withPhotoDevelopProxyFrameV1({frame:{descriptor:descriptor(8),pixels},develop:{...defaultPhotoDevelopV1(),effects:[grain()]},signal:stop.signal},async view=>{
		borrowed=view.frame.pixels; entered.resolve(); await release.promise;
	});
	const observed=pending.then(()=>({rejected:false,reason:undefined as unknown}),(error:unknown)=>({rejected:true,reason:error}));
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(pending),true); assert.ok(borrowed?.some(byte=>byte!==0)); release.resolve();
	const result=await observed; assert.equal(result.rejected,true); assert.equal(result.reason===reason,true); assert.equal(traps,0);
	assert.ok(borrowed?.every(byte=>byte===0)); assert.deepEqual([...pixels],[...source()]);
});
