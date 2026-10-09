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

test('actual Frame effect authoring persists and renders all eight HSL bands through the existing menu service',async()=>{
	let project=createFramescaperProjectFinishing(PROFILE,framescaperV20Options());
	const view=(value:unknown)=>value as VideoEffectProject,generation=new EditorProjectGeneration();generation.activate(view(project).id);
	const service=createVideoEffectService({state:{selectedClipId:'video-clip',readOnly:false,videoEffectGestures:new Map()},
		copy:{projectReadOnly:'Read only'},getProject:()=>view(project),captureProject:()=>generation.capture(view(project).id),
		assertProject:token=>{generation.assertCurrent(token);},editingBlocked:()=>false,
		commit:command=>{project=applyFramescaperProjectCommandFinishing(PROFILE,project,command);return view(project);},publishDocumentSnapshot(){},
	});
	const params=Object.fromEntries(['red','orange','yellow','green','aqua','blue','purple','magenta'].map(color=>[`${color}Hue`,60]));
	service.addVideoClipEffect('video-clip','hsl-mixer-v1',{id:'hsl',params});
	const clip=view(cloneFramescaperProjectFinishing(PROFILE,project)).clips.find(row=>row.id==='video-clip');
	assert.deepEqual(clip?.videoEffects?.map(row=>row.type),['hsl-mixer-v1']);
	const pixels=new Uint8Array([254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	const rendered=await applyVideoExactBrowserEffectsFinishing({width:4,height:1,pixels},clip?.videoEffects??[],new AbortController().signal);
	assert.deepEqual([...rendered.pixels],[254,254,0,0,127,254,0,1,0,254,254,127,254,0,254,255]);
	assert.deepEqual([...pixels],[254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	assert.equal(VIDEO_EFFECT_TYPES[17],'hsl-mixer-v1');
	assert.throws(()=>createVideoEffect('hsl-mixer-v1',{id:'x'.repeat(129)}));
});

test('real Frame model and CPU renderer admit65 ordered HSL effects while closed input refusal precedes reads',async()=>{
	const effects=Array.from({length:65},(_,index)=>createVideoEffect('hsl-mixer-v1',{id:`hsl-${String(index)}`,params:{redHue:index===64?60:0}}));
	const context=framescaperV20Options();
	const clips=context.clips as readonly Readonly<{id:string;videoEffects?:readonly unknown[]}>[];
	const saved=createFramescaperProjectFinishing(PROFILE,{...context,clips:clips.map(clip=>clip.id==='video-clip'?{...clip,videoEffects:effects}:clip)});
	const recipe=(saved.clips as typeof clips).find(clip=>clip.id==='video-clip')?.videoEffects??[];
	assert.equal(recipe.length,65);
	const frame={width:1,height:1,pixels:new Uint8Array([255,0,0,127])};
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(frame,recipe,new AbortController().signal)).pixels],[255,255,0,127]);
	let reads=0;const params=Object.defineProperty({},'redHue',{enumerable:true,get(){reads++;return 0;}});
	await assert.rejects(applyVideoExactBrowserEffectsFinishing(frame,[{id:'hsl',type:'hsl-mixer-v1',enabled:true,params}],new AbortController().signal));
	assert.equal(reads,0);assert.deepEqual([...frame.pixels],[255,0,0,127]);
});
