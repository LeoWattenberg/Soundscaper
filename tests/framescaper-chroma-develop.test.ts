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

test('actual Frame authoring/persistence renders admitted chroma from the existing effect service', async () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE,project,command); return view(project); }, publishDocumentSnapshot() {},
	});
	service.addVideoClipEffect('video-clip','chroma-v1',{ id: 'color', params: { saturation: 100 } });
	const clip = view(cloneFramescaperProjectFinishing(PROFILE,project)).clips.find(row=>row.id==='video-clip');
	assert.deepEqual(clip?.videoEffects?.map(row=>row.type), ['chroma-v1']);
	const source = new Uint8Array([0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255]);
	const output = await applyVideoExactBrowserEffectsFinishing({width:4,height:1,pixels:source},clip?.videoEffects ?? [],new AbortController().signal);
	assert.deepEqual(Array.from(output.pixels), [0,36,100,0,9,137,255,1,128,128,128,127,255,233,0,255]);
	assert.deepEqual(Array.from(source), [0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255]);
	assert.equal(VIDEO_EFFECT_TYPES[15], 'chroma-v1');
	assert.throws(()=>createVideoEffect('chroma-v1',{id:'x'.repeat(129)}));
});

test('real photo proxy applies the same chroma pixels, histogram and scoped wipe without source mutation', async () => {
	const pixels = new Uint8Array([0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255]);
	let retained: Uint8Array | null = null;
	const result = await withPhotoDevelopProxyV1({ frame: { descriptor: descriptor(4,1), pixels },
		develop: { ...defaultPhotoDevelopV1(), effects: [createVideoEffect('chroma-v1',{params:{saturation:-100}})] } }, view=>{
		retained = view.frame.pixels; return { pixels:[...view.frame.pixels],histogram:view.histogram };
	});
	assert.deepEqual(result.pixels, [28,28,28,0,119,119,119,1,128,128,128,127,215,215,215,255]);
	assert.equal(result.histogram.transparentPixels,1); assert.equal(result.histogram.sampledPixels,3);
	for (const n of [119,128,215]) assert.equal(result.histogram.bins.red[n],1);
	assert.equal((retained as Uint8Array | null)?.every(byte=>byte===0),true);
	assert.deepEqual([...pixels],[0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255]);
});

test('yielding chroma snapshots native source/settings and survives caller transfer while preserving bounded output', async () => {
	const pixels = new Uint8Array(512*256*4); for (let i=0;i<pixels.length;i+=4) pixels.set([64,128,192,127],i);
	const effect = createVideoEffect('chroma-v1',{params:{saturation:100}});
	const work = withGlobalDevelopPixelFrameV1({frame:{descriptor:descriptor(512,256),pixels},effects:[effect]},
		view=>[...view.pixels.subarray(0,4)],{limits:{maximumSidePixels:512,maximumPixels:131072,maximumBytes:524288}});
	structuredClone(pixels.buffer,{transfer:[pixels.buffer]}); assert.equal(Reflect.set(effect.params,'saturation',-100),true);
	assert.deepEqual(await work,[9,137,255,127]); assert.equal(pixels.byteLength,0);
});

test('held chroma consumer cancellation joins then wipes and preserves opaque native reason without reflection', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let retained: Uint8Array | null = null, traps=0;
	const reason = new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();}});
	const work = withGlobalDevelopPixelFrameV1({frame:{descriptor:descriptor(1,1),pixels:new Uint8Array([64,128,192,1])},
		effects:[createVideoEffect('chroma-v1',{params:{vibrance:100}})],signal:stop.signal}, async view=>{
		retained=view.pixels; assert.deepEqual([...view.pixels],[37,132,228,1]); entered.resolve(); await release.promise;
	},{limits:{maximumSidePixels:1,maximumPixels:1,maximumBytes:4}});
	const result = work.then(()=>({rejected:false,reason:undefined as unknown}),error=>({rejected:true,reason:error as unknown}));
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work),true); release.resolve();
	const outcome=await result; assert.equal(outcome.rejected,true); assert.equal(outcome.reason,reason); assert.equal(traps,0);
	assert.equal((retained as Uint8Array | null)?.every(byte=>byte===0),true);
});

test('real Frame admits and renders65 chroma effects through its existing100000-node owner limit',async()=>{
	const options=framescaperV20Options(), effects=Array.from({length:65},(_,n)=>createVideoEffect('chroma-v1',
		{id:`chroma-${String(n)}`,params:{saturation:n===64?100:0}}));
	(options.clips as Record<string,unknown>[])[0]!.videoEffects=effects;
	const project=createFramescaperProjectFinishing(PROFILE,options) as unknown as VideoEffectProject;
	const clip=project.clips.find(row=>row.id==='video-clip');assert.equal(clip?.videoEffects?.length,65);
	const output=await applyVideoExactBrowserEffectsFinishing({width:1,height:1,pixels:new Uint8Array([64,128,192,127])},clip?.videoEffects ?? [],new AbortController().signal);
	assert.deepEqual([...output.pixels],[9,137,255,127]);
});

function descriptor(width:number,height:number) { return {schemaVersion:1 as const,width,height,sampleFormat:'unorm8' as const,primaries:'srgb' as const,transfer:'srgb' as const}; }
