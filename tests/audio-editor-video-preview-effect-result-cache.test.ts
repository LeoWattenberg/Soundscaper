/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewEffectResultCache,
	VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_BYTES,
	VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_ENTRIES,
} from '../src/common/editor/controller/clip-video/video-preview-effect-result-cache.ts';

function input(key: string | object = {}) {
	return {
		key, texture: {}, frameVersion: 1, targets: {},
		passes: [{ code: 1, params0: [0.2, 1, 1, 1] }],
		width: 1_280, height: 720,
		viewport: { x: 0, y: 0, width: 1_280, height: 720 },
	};
}

function fixture() {
	const allocated: object[] = [];
	const released: object[] = [];
	let failAllocation = false;
	const cache = createVideoPreviewEffectResultCache({
		allocate: () => {
			if (failAllocation) throw new Error('allocation failed');
			const target = {};
			allocated.push(target);
			return target;
		},
		release: (target: object) => { released.push(target); },
	});
	function complete(request: ReturnType<typeof input>): object {
		const target = cache.acquire(request);
		assert.ok(target);
		cache.store(request, target);
		return target;
	}
	return { cache, allocated, released, complete, fail: () => { failAllocation = true; } };
}

test('reuses completed effects with equal resolved passes despite new parameter objects', () => {
	const { cache, complete } = fixture();
	const request = input();
	assert.equal(cache.get(request), null);
	const target = cache.acquire(request);
	assert.equal(cache.get(request), null, 'allocated targets are not completed effect results');
	assert.ok(target);
	cache.store(request, target);
	assert.equal(cache.get({ ...request, passes: [{ code: 1, params0: [0.2, 1, 1, 1] }] }), target);
	assert.equal(complete(request), target, 'updates reuse the owned GPU target');
});

test('retains independent results per clip even when clips share the source texture', () => {
	const { cache, complete } = fixture();
	const first = input('first');
	const second = { ...first, key: 'second', passes: [{ code: 1, params0: [0.8, 1, 1, 1] }] };
	const firstTarget = complete(first);
	const secondTarget = complete(second);
	assert.notEqual(firstTarget, secondTarget);
	assert.equal(cache.get(first), firstTarget);
	assert.equal(cache.get(second), secondTarget);
});

test('resolved parameters, decoded frames and source texture owners invalidate independently', () => {
	const { cache, complete, allocated } = fixture();
	const request = input();
	const target = complete(request);
	assert.equal(cache.get({ ...request, frameVersion: 2 }), null);
	assert.equal(cache.get({ ...request, texture: {} }), null);
	request.passes[0]!.params0[0] = 0.3;
	assert.equal(cache.get(request), null, 'in-place parameter edits invalidate the snapshot');
	assert.equal(complete(request), target);
	assert.equal(allocated.length, 1);
});

test('viewport, dimensions and replacement render targets invalidate and resize owned targets', () => {
	const { cache, complete, released } = fixture();
	const request = input();
	const target = complete(request);
	assert.equal(cache.get({ ...request, width: 640 }), null);
	assert.equal(cache.get({ ...request, height: 360 }), null);
	assert.equal(cache.get({ ...request, viewport: { ...request.viewport, x: 10 } }), null);
	assert.equal(cache.get({ ...request, targets: {} }), null);
	const resized = { ...request, width: 640, height: 360, targets: {} };
	assert.notEqual(complete(resized), target);
	assert.deepEqual(released, [target]);
});

test('frame cleanup releases departed and no longer reusable clips once', () => {
	const { cache, complete, released } = fixture();
	const first = input('first');
	const second = input('second');
	const firstTarget = complete(first);
	const secondTarget = complete(second);
	cache.beginFrame(['first']);
	assert.deepEqual(released, [secondTarget], 'departed clips leave before admitting new targets');
	assert.equal(cache.get(first), firstTarget);
	cache.endFrame();
	assert.deepEqual(released, [secondTarget]);
	cache.beginFrame(['first']);
	cache.endFrame();
	assert.deepEqual(released, [secondTarget, firstTarget], 'uncacheable active clips release their targets');
	cache.clear();
	cache.clear();
	assert.deepEqual(released, [secondTarget, firstTarget]);
});

test('entry admission stays bounded and does not evict another active result', () => {
	const { cache, complete, allocated } = fixture();
	const requests = Array.from({ length: VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_ENTRIES }, (_, index) => input(String(index)));
	const retained = requests.map(complete);
	assert.equal(cache.acquire(input('overflow')), null);
	assert.equal(allocated.length, VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_ENTRIES);
	for (const [index, request] of requests.entries()) assert.equal(cache.get(request), retained[index]);
	cache.beginFrame(['replacement']);
	assert.ok(cache.acquire(input('replacement')), 'departed entries make room for a new clip');
});

test('retained RGBA bytes stay bounded and oversized targets skip the optional copy', () => {
	const { cache, allocated, complete } = fixture();
	const first = { ...input('first'), width: 4_096, height: 2_048 };
	const second = { ...first, key: 'second' };
	complete(first);
	complete(second);
	assert.equal(first.width * first.height * 4 * 2, VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_BYTES);
	assert.equal(cache.acquire(input('overflow')), null);
	assert.equal(allocated.length, 2);
	cache.clear();
	assert.equal(cache.acquire({ ...first, width: 4_097, height: 4_096 }), null);
	assert.equal(cache.acquire({ ...first, width: Number.MAX_SAFE_INTEGER }), null);
	assert.equal(allocated.length, 2, 'inadmissible extents never allocate');
});

test('allocation failure leaves other completed entries live and falls back to scratch output', () => {
	const { cache, complete, fail, released } = fixture();
	const request = input('retained');
	const target = complete(request);
	fail();
	assert.equal(cache.acquire(input('failed')), null);
	assert.equal(cache.get(request), target);
	assert.deepEqual(released, []);
	cache.clear();
	cache.clear();
	assert.deepEqual(released, [target]);
});

test('only the target allocated for a clip can become its retained result', () => {
	const { cache } = fixture();
	const request = input();
	assert.ok(cache.acquire(request));
	cache.store(request, {});
	assert.equal(cache.get(request), null);
});
