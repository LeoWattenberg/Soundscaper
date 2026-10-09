/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import type { VideoEffectParameterV1 } from '../src/common/editor/video-curve-types-v1.ts';

const source = [40,40,40,255,100,100,100,255,160,160,160,255], expected = [25,25,25,255,100,100,100,255,175,175,175,255];

test('actual Frame effect author service persists a renderable detail-sharpen recipe with closed native parameters', async () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {} });
	service.addVideoClipEffect('video-clip', 'detail-sharpen-v1', { id: 'sharp', params: { amount: 100, threshold: 0 } });
	const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(value => value.id === 'video-clip')!;
	assert.deepEqual(clip.videoEffects?.[0], { id: 'sharp', type: 'detail-sharpen-v1', enabled: true, params: { amount: 100, threshold: 0 } });
	const frame = { width: 3, height: 1, pixels: new Uint8Array(source) };
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(frame, clip.videoEffects!, new AbortController().signal)).pixels], expected);
	assert.deepEqual([...frame.pixels], source); assert.throws(() => createVideoEffect('detail-sharpen-v1', { id: 'x'.repeat(129) }));
});

test('actual Frame and owning registry refuse disabled corrupt detail settings before invoking source getters', async () => {
	let reads=0;const params=Object.defineProperty({},'amount',{enumerable:true,get(){reads++;return 100;}});
	const bad={id:'bad',type:'detail-sharpen-v1',enabled:false,params};
	assert.throws(()=>createVideoEffect('detail-sharpen-v1',{enabled:false,params}));
	const frame=Object.defineProperty({},'pixels',{enumerable:true,get(){reads++;throw Error('Source must not be admitted');}});
	await assert.rejects(applyVideoExactBrowserEffectsFinishing(frame as unknown as Parameters<typeof applyVideoExactBrowserEffectsFinishing>[0],[bad],new AbortController().signal));
	assert.equal(reads,0);
});

test('real Photo state and proxy evaluate the same neighborhood and preserve declared old sharpen bytes', async () => {
	const effect = createVideoEffect('detail-sharpen-v1', { id: 'sharp', params: { amount: 100 } });
	const develop = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects: [effect] });
	const frame = { descriptor: { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(source) };
	assert.deepEqual(await withPhotoDevelopProxyV1({ frame, develop }, view => [...view.frame.pixels]), expected); assert.deepEqual([...frame.pixels], source);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([createVideoEffect('sharpen')]), [{ expression:
		'unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.5:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0', preserveAlpha: false }]);
});

test('ordered detail and tone stages retain their separate process quantization in Frame and Photo', async () => {
	const sharp = createVideoEffect('detail-sharpen-v1', { id: 'sharp', params: { amount: 100 } });
	const dark = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }), frame = { width: 3, height: 1, pixels: new Uint8Array(source) };
	const first = await applyVideoExactBrowserEffectsFinishing(frame, [sharp, dark], new AbortController().signal);
	const second = await applyVideoExactBrowserEffectsFinishing(frame, [dark, sharp], new AbortController().signal);
	assert.notDeepEqual([...first.pixels], [...second.pixels]);
	for (const effects of [[sharp, dark], [dark, sharp]]) {
		const develop = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects });
		const rendered = await withPhotoDevelopProxyV1({ frame: { descriptor: { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: frame.pixels }, develop },
			view => [...view.frame.pixels]);
		assert.deepEqual(rendered, [...(effects[0] === sharp ? first : second).pixels]);
	}
});

test('Photo natural crop ordering changes the owning replicated-edge neighborhood without changing source geometry bytes', async () => {
	const pixels=new Uint8Array([40,40,40,255,100,100,100,255,160,160,160,255,220,220,220,255]);
	const crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropX:0.25,cropWidth:0.5}}),sharp=createVideoEffect('detail-sharpen-v1',{id:'sharp'});
	for(const[effects,expected]of [[[crop,sharp],[85,85,85,255,175,175,175,255]],[[sharp,crop],[100,100,100,255,160,160,160,255]]]as const){
		const output=await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:4,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
			develop:{...defaultImageDevelopStateV1(),effects}},view=>({width:view.frame.descriptor.width,pixels:[...view.frame.pixels]}));
		assert.equal(output.width,2);assert.deepEqual(output.pixels,expected);
	}
	assert.deepEqual([...pixels],[40,40,40,255,100,100,100,255,160,160,160,255,220,220,220,255]);
});

test('actual Frame retains its65-stage admission and wipes undelivered detail clones after queued opaque cancellation', async () => {
	const effects=Array.from({length:65},(_,n)=>createVideoEffect('detail-sharpen-v1',{id:`detail-${String(n)}`,params:{amount:n===64?100:0}}));
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels:new Uint8Array(source)},effects,new AbortController().signal)).pixels],expected);
	const pixels=new Uint8Array(source),stop=new AbortController(),intrinsic=Uint8Array.prototype.slice,copies:Uint8Array[]=[],borrowed:Uint8Array[]=[];let reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Uint8Array.prototype.slice=function(...args:Parameters<typeof intrinsic>){const copy=Reflect.apply(intrinsic,this,args)as ReturnType<typeof intrinsic>;copies.push(copy);borrowed.push(this);return copy;};
	try{
		queueMicrotask(()=>{stop.abort(reason);});
		const result=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[effects[64]!],stop.signal)
			.then(()=>({failed:false,reason:undefined as unknown}),error=>({failed:true,reason:error as unknown}));
		assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(reads,0);assert.equal(copies.length,2);
		assert.ok(copies.every(copy=>copy.every(byte=>byte===0)));assert.ok(borrowed.filter(copy=>copy.buffer!==pixels.buffer).every(copy=>copy.every(byte=>byte===0)));
		assert.deepEqual([...pixels],source);
	}finally{Uint8Array.prototype.slice=intrinsic;}
});


test('persisted Frame and Photo keep wheel → detail → point-curve order with exact partial-alpha literals', async () => {
	const authored: readonly [string, string, Readonly<Record<string, VideoEffectParameterV1>>][] = [
		['wheel', 'color-wheels-v1', { highlightsLuminance: 100 }], ['detail', 'detail-sharpen-v1', { amount: 50, threshold: 3 }],
		['curve', 'point-curves-v1', { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }]];
	const effects = authored.map(([id, type, params]) => createVideoEffect(type, { id, params }));
	const pixels = new Uint8Array([40,80,120,0,100,140,180,127,160,200,240,255]);
	// Independently rounded gain2 sRGB samples are 58/111/165,138/192/245,218/255/255.
	// Alpha-weighted binomial50% produces 58/111/165,118/176/243,224/255/255; then invert.
	const expected = [197,144,90,0,137,79,12,127,31,0,0,255];
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {} });
	for (const [id, type, params] of authored) service.addVideoClipEffect('video-clip', type, { id, params });
	const persisted = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(value => value.id === 'video-clip')!.videoEffects!;
	assert.deepEqual(persisted, effects);
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels }, persisted, new AbortController().signal)).pixels], expected);
	const develop = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects: persisted });
	const photo = await withPhotoDevelopProxyV1({ frame: { descriptor: { schemaVersion: 1, width: 3, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, develop }, value => ({ pixels: [...value.frame.pixels], histogram: value.histogram }));
	assert.deepEqual(photo.pixels, expected); assert.equal(photo.histogram.sampledPixels, 2);
	assert.deepEqual([...pixels], [40,80,120,0,100,140,180,127,160,200,240,255]);
});
