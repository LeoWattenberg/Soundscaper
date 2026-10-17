/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopProxyFrameV1, PHOTO_DEVELOP_PROXY_LIMITS_V1 as ownerLimits } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { withPhotoDevelopProxyV1, PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const source=()=>({descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},
	pixels:new Uint8Array([40,40,40,255,100,100,100,255,160,160,160,255])});

test('the compatibility proxy and named fixed-profile owner deliver identical ordered pixels, histogram and bounds',async()=>{
	assert.equal(PHOTO_DEVELOP_PROXY_LIMITS_V1,ownerLimits);
	const develop={...defaultPhotoDevelopV1(),effects:[createVideoEffect('detail-sharpen-v1',{params:{amount:50}})]};
	const read=(view:Parameters<Parameters<typeof withPhotoDevelopProxyV1>[1]>[0])=>({descriptor:view.frame.descriptor,pixels:[...view.frame.pixels],histogram:view.histogram});
	const current=await withPhotoDevelopProxyV1({frame:source(),develop},read),owned=await withPhotoDevelopProxyFrameV1({frame:source(),develop},read);
	assert.deepEqual(owned,current);assert.deepEqual(owned.pixels,[33,33,33,255,100,100,100,255,168,168,168,255]);
	assert.equal(owned.histogram.bins.red[33],1);assert.equal(owned.histogram.bins.red[168],1);
	for(const run of [withPhotoDevelopProxyV1,withPhotoDevelopProxyFrameV1]){
		const frame=source();await assert.rejects(run({frame:{...frame,descriptor:{...frame.descriptor,width:2049}},develop},()=>assert.fail('Fixed proxy limits must refuse')));
		await assert.rejects(run({frame,develop,limits:{maximumSidePixels:8192}},()=>assert.fail('No caller-selected profile')));
	}
});

test('both entrypoints join held opaque cancellation and wipe the delivered backing without mutating source',async()=>{
	for(const run of [withPhotoDevelopProxyV1,withPhotoDevelopProxyFrameV1]){
		const frame=source(),stop=new AbortController(),entered=deferred<void>(),release=deferred<void>();let pixels:Uint8Array|undefined,reads=0;
		const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
		const work=run({frame,develop:defaultPhotoDevelopV1(),signal:stop.signal},async view=>{pixels=view.frame.pixels;entered.resolve();await release.promise;});
		const observed=work.then(()=>({failed:false,reason:undefined as unknown}),error=>({failed:true,reason:error as unknown}));
		await entered.promise;stop.abort(reason);assert.equal(await remainsPending(work),true);release.resolve();const result=await observed;
		assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(reads,0);assert.ok(pixels?.every(n=>n===0));
		assert.deepEqual([...frame.pixels],[40,40,40,255,100,100,100,255,160,160,160,255]);
	}
});
