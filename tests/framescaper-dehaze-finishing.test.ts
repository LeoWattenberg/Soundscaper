/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect,normalizeVideoEffect,serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { videoEffectPasses,EFFECT_CODES,EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { isCompiledDehazeOperationV1 } from '../src/common/editor/video-dehaze-ffmpeg-v1.ts';
import { isCompiledNoiseReductionOperationV1 } from '../src/common/editor/video-noise-reduction-ffmpeg-v1.ts';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { DEHAZE_SOURCE_V1,DEHAZE_GOLDENS_V1,dehazeReferenceV1 } from './helpers/video-dehaze-reference.ts';

const dehaze = (amount = 100) => createVideoEffect('dehaze-v1',{ id: 'dehaze',params: { amount } });
const descriptor = (width: number,height: number) => ({ schemaVersion: 1,width,height,sampleFormat: 'unorm8',primaries: 'srgb',transfer: 'srgb' });

test('shared Dehaze registration owns shader33, private compiled dispatch and neutral/disabled admission', () => {
	const effect = dehaze(); assert.deepEqual(normalizeVideoEffect(effect),effect);
	assert.equal(EFFECT_CODES['dehaze-v1'],33); assert.equal(EFFECT_PROGRAM_COUNT,34);
	assert.deepEqual(videoEffectPasses(effect),[{ code: 33,params0: [256,0,0,0],params1: [0,0,0,0],direction: [0,0] }]);
	const operation = serializeVideoEffectsToFfmpegOperations([effect])[0]; assert.ok(operation); assert.ok(isCompiledDehazeOperationV1(operation));
	const filters: string[] = []; appendVideoEffectOperation({ filters,inputLabel: '0:v',outputLabel: 'dehaze',operation,width: 2,height: 2 });
	const before = [...filters]; assert.throws(() => appendVideoEffectOperation({ filters,inputLabel: '0:v',outputLabel: 'copy',operation: { ...operation },width: 2,height: 2 }));
	assert.deepEqual(filters,before); assert.deepEqual(videoEffectPasses(dehaze(0)),[]);
	assert.throws(() => createVideoEffect('dehaze-v1',{ enabled: false,params: { amount: 101 } }));
	for (const bad of [{ future: 1 },{ enabled: null },{ index: -1 },{ index: 0.5 },{ id: undefined },{ type: 'dehaze-v2' }]) assert.throws(() => createVideoEffect('dehaze-v1',bad));
	const oldNoise = serializeVideoEffectsToFfmpegOperations([createVideoEffect('noise-reduction-v1',{ params: { color: 50 } })])[0];
	assert.ok(isCompiledNoiseReductionOperationV1(oldNoise)); assert.equal(EFFECT_CODES['noise-reduction-v1'],30);
});

test('Frame finishing and both named Photo profiles preserve fractional Dehaze goldens and scoped output retirement', async () => {
	const source = new Uint8Array(DEHAZE_SOURCE_V1);
	for (const [amount,expected] of DEHAZE_GOLDENS_V1) {
		const effect = dehaze(amount),output = await applyVideoExactBrowserEffectsFinishing({ width: 2,height: 2,pixels: source },[effect],new AbortController().signal);
		try { assert.deepEqual([...output.pixels],expected); } finally { output.pixels.fill(0); }
		for (const render of [withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1]) {
			let borrowed: Uint8Array | undefined;
			assert.deepEqual(await render({ frame: { descriptor: descriptor(2,2),pixels: source },develop: { ...defaultPhotoDevelopV1(),effects: [effect] } },view => {
				borrowed = view.frame.pixels; return [...view.frame.pixels];
			}),expected); assert.ok(borrowed?.every(byte => byte === 0));
		}
	}
	assert.deepEqual([...source],DEHAZE_SOURCE_V1);
});

test('Photo crop changes Dehaze current natural neighborhoods in authored order', async () => {
	const original = new Uint8Array([0,96,128,255,128,160,192,255,224,192,96,255]);
	const crop = createVideoEffect('develop-geometry-v1',{ params: { cropX: 1/3,cropWidth: 2/3 } });
	const render = (effects: readonly unknown[]) => withPhotoDevelopProxyFrameV1({ frame: { descriptor: descriptor(3,1),pixels: original },
		develop: { ...defaultPhotoDevelopV1(),effects } },view => ({ width: view.frame.descriptor.width,pixels: [...view.frame.pixels] }));
	const cropFirst = await render([crop,dehaze()]),dehazeFirst = await render([dehaze(),crop]);
	assert.deepEqual(cropFirst,{ width: 2,pixels: dehazeReferenceV1(original.slice(4),2,100) });
	assert.deepEqual(dehazeFirst,{ width: 2,pixels: dehazeReferenceV1(original,3,100).slice(4) });
	assert.notDeepEqual(cropFirst,dehazeFirst); assert.deepEqual([...original],[0,96,128,255,128,160,192,255,224,192,96,255]);
});

test('final Frame delivery checks cancellation after Dehaze scoped cloning and wipes undelivered bytes', async () => {
	const source = new Uint8Array(DEHAZE_SOURCE_V1),effect = dehaze(),stop = new AbortController(),slice = Uint8Array.prototype.slice,copies: Uint8Array[] = []; let reads = 0;
	const reason = new Proxy({}, { get() { reads++; throw Error(); },getOwnPropertyDescriptor() { reads++; throw Error(); },getPrototypeOf() { reads++; throw Error(); } });
	Uint8Array.prototype.slice = function(...args: Parameters<typeof slice>) {
		const copy = Reflect.apply(slice,this,args) as Uint8Array<ArrayBuffer>; copies.push(copy);
		if (copies.length === 2) queueMicrotask(() => queueMicrotask(() => stop.abort(reason))); return copy;
	};
	let result: Readonly<{ rejected: boolean;reason: unknown }>;
	try { result = await applyVideoExactBrowserEffectsFinishing({ width: 2,height: 2,pixels: source },[effect],stop.signal)
		.then(() => ({ rejected: false,reason: undefined }),error => ({ rejected: true,reason: error as unknown })); }
	finally { Uint8Array.prototype.slice = slice; }
	assert.equal(stop.signal.aborted,true); assert.equal(result.rejected,true); assert.equal(result.reason === reason,true); assert.equal(reads,0);
	assert.equal(copies.length,2); assert.ok(copies.every(copy => copy.every(byte => byte === 0))); assert.deepEqual([...source],DEHAZE_SOURCE_V1);
});

test('full-resolution Dehaze uses its fixed Photo profile beyond proxy width without widening the proxy admission', async () => {
	const source = new Uint8Array(Array.from({ length: 2052 },(_,n) => n % 2 === 0 ? [128,128,128,255] : [192,192,192,255]).flat());
	const request = { frame: { descriptor: descriptor(2052,1),pixels: source },develop: { ...defaultPhotoDevelopV1(),effects: [dehaze()] } };
	let calls = 0,borrowed: Uint8Array | undefined;
	await assert.rejects(withPhotoDevelopProxyFrameV1(request,() => { calls++; })); assert.equal(calls,0);
	await withPhotoDevelopFullResolutionFrameV1(request,view => {
		calls++; borrowed = view.frame.pixels; assert.equal(view.frame.descriptor.width,2052);
		assert.deepEqual([...view.frame.pixels.slice(0,8)],[14,14,14,255,136,136,136,255]);
		assert.deepEqual([...view.frame.pixels.slice(-8)],[14,14,14,255,136,136,136,255]);
	});
	assert.equal(calls,1); assert.ok(borrowed?.every(byte => byte === 0)); assert.deepEqual([...source.slice(0,8)],[128,128,128,255,192,192,192,255]);
});
