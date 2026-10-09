/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createVideoEffect, VIDEO_EFFECT_TYPES } from '../src/common/editor/video-effects.js';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('actual Frame authoring persists and renders the black-and-white mix through its existing effect service', async () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {},
	});
	service.addVideoClipEffect('video-clip', 'black-white-mix-v1', { id: 'mono', params: {} });
	const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip');
	assert.deepEqual(clip?.videoEffects?.map(row => row.type), ['black-white-mix-v1']);
	const pixels = new Uint8Array([254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	const output = await applyVideoExactBrowserEffectsFinishing({ width: 4, height: 1, pixels }, clip?.videoEffects ?? [], new AbortController().signal);
	assert.deepEqual([...output.pixels], [54,54,54,0,144,144,144,1,182,182,182,127,19,19,19,255]);
	assert.deepEqual([...pixels], [254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	assert.equal(VIDEO_EFFECT_TYPES[16], 'black-white-mix-v1');
	assert.throws(() => createVideoEffect('black-white-mix-v1', { id: 'x'.repeat(129) }));
});

test('real Photo proxy evaluates hue controls, exposes the resulting histogram and wipes scoped output',async()=>{
	const pixels=new Uint8Array([254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);let retained:Uint8Array|null=null;
	const result=await withPhotoDevelopProxyV1({frame:{descriptor:descriptor(4,1),pixels},
		develop:{...defaultPhotoDevelopV1(),effects:[createVideoEffect('black-white-mix-v1',{params:{orange:-25}})]}},view=>{
		retained=view.frame.pixels;return {pixels:[...view.frame.pixels],histogram:view.histogram};
	});
	assert.deepEqual(result.pixels,[54,54,54,0,81,81,81,1,182,182,182,127,19,19,19,255]);
	assert.equal(result.histogram.transparentPixels,1);assert.equal(result.histogram.sampledPixels,3);
	for(const gray of [81,182,19])assert.equal(result.histogram.bins.red[gray],1);
	assert.equal((retained as Uint8Array|null)?.every(byte=>byte===0),true);
	assert.deepEqual([...pixels],[254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
});

test('yielding monochrome owns one stable native source/settings snapshot despite caller transfer/mutation',async()=>{
	const pixels=new Uint8Array(512*256*4);for(let i=0;i<pixels.length;i+=4)pixels.set([254,127,0,127],i);
	const effect=createVideoEffect('black-white-mix-v1',{params:{orange:-25}});
	const work=withGlobalDevelopPixelFrameV1({frame:{descriptor:descriptor(512,256),pixels},effects:[effect]},view=>[...view.pixels.subarray(0,4)],
		{limits:{maximumSidePixels:512,maximumPixels:131072,maximumBytes:524288}});
	structuredClone(pixels.buffer,{transfer:[pixels.buffer]});assert.equal(Reflect.set(effect.params,'orange',100),true);
	assert.deepEqual(await work,[81,81,81,127]);assert.equal(pixels.byteLength,0);
});

test('held monochrome consumer cancellation joins/wipes and returns exact opaque reason without inspection',async()=>{
	const entered=deferred<void>(),release=deferred<void>(),stop=new AbortController();let retained:Uint8Array|null=null,traps=0;
	const reason=new Proxy({},{get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();}});
	const work=withGlobalDevelopPixelFrameV1({frame:{descriptor:descriptor(1,1),pixels:new Uint8Array([254,127,0,1])},
		effects:[createVideoEffect('black-white-mix-v1',{params:{orange:-25}})],signal:stop.signal},async view=>{
		retained=view.pixels;assert.deepEqual([...view.pixels],[81,81,81,1]);entered.resolve();await release.promise;
	},{limits:{maximumSidePixels:1,maximumPixels:1,maximumBytes:4}});
	const result=work.then(()=>({rejected:false,reason:undefined as unknown}),error=>({rejected:true,reason:error as unknown}));
	await entered.promise;stop.abort(reason);assert.equal(await remainsPending(work),true);release.resolve();
	const outcome=await result;assert.equal(outcome.rejected,true);assert.equal(outcome.reason,reason);assert.equal(traps,0);
	assert.equal((retained as Uint8Array|null)?.every(byte=>byte===0),true);
});

test('real Frame65-effect admission retains its100000-node ceiling and renders the final monochrome operation',async()=>{
	const options=framescaperV20Options(),effects=Array.from({length:65},(_,n)=>createVideoEffect('black-white-mix-v1',{id:`mono-${String(n)}`,enabled:n===64}));
	(options.clips as Record<string,unknown>[])[0]!.videoEffects=effects;
	const project=createFramescaperProjectFinishing(PROFILE,options) as unknown as VideoEffectProject;
	const clip=project.clips.find(row=>row.id==='video-clip');assert.equal(clip?.videoEffects?.length,65);
	const output=await applyVideoExactBrowserEffectsFinishing({width:1,height:1,pixels:new Uint8Array([254,127,0,127])},clip?.videoEffects??[],new AbortController().signal);
	assert.deepEqual([...output.pixels],[144,144,144,127]);
});

test('actual Frame keeps monochrome/tone author order and refuses hostile new settings before source reflection',async()=>{
	const mono=createVideoEffect('black-white-mix-v1',{params:{red:100}}),tone=createVideoEffect('tone-ladder-v1',{params:{exposure:-1}});
	const source={width:1,height:1,pixels:new Uint8Array([255,0,0,127])},signal=new AbortController().signal;
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(source,[mono,tone],signal)).pixels],[188,188,188,127]);
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(source,[tone,mono],signal)).pixels],[228,228,228,127]);
	let settingsReads=0,sourceReads=0;
	const params=Object.defineProperty({},'red',{enumerable:true,get(){settingsReads++;throw Error('settings inspected');}});
	const hostile=Object.defineProperty({width:1,height:1},'pixels',{enumerable:true,get(){sourceReads++;throw Error('source inspected');}});
	await assert.rejects(applyVideoExactBrowserEffectsFinishing(hostile as typeof source,[{id:'bad',type:'black-white-mix-v1',enabled:true,params}],signal));
	assert.equal(settingsReads,0);assert.equal(sourceReads,0);
});

function descriptor(width:number,height:number){return {schemaVersion:1 as const,width,height,sampleFormat:'unorm8' as const,primaries:'srgb' as const,transfer:'srgb' as const};}
