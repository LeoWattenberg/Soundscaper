/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewEffectResultCache,
} from '../src/common/editor/controller/clip-video/video-preview-effect-result-cache.ts';

function input() {
	return {
		texture: {}, frameVersion: 1, targets: {},
		passes: [{ code: 1, params0: [0.2, 1, 1, 1] }],
		width: 1_280, height: 720,
		viewport: { x: 0, y: 0, width: 1_280, height: 720 },
	};
}

test('reuses completed effects with equal resolved passes despite new parameter objects', () => {
	const cache = createVideoPreviewEffectResultCache<object>();
	const request = input();
	const target = {};
	assert.equal(cache.get(request), null);
	cache.store(request, target);
	assert.equal(cache.get({ ...request, passes: [{ code: 1, params0: [0.2, 1, 1, 1] }] }), target);
});

test('resolved animated parameters, new decoded frames and texture owners invalidate the result', () => {
	const cache = createVideoPreviewEffectResultCache<object>();
	const request = input();
	cache.store(request, {});
	assert.equal(cache.get({ ...request, frameVersion: 2 }), null);
	assert.equal(cache.get({ ...request, texture: {} }), null);
	request.passes[0]!.params0[0] = 0.3;
	assert.equal(cache.get(request), null, 'in-place parameter edits also invalidate cached output');
});

test('viewport, dimensions and replacement render targets invalidate the result', () => {
	const cache = createVideoPreviewEffectResultCache<object>();
	const request = input();
	cache.store(request, {});
	assert.equal(cache.get({ ...request, width: 640 }), null);
	assert.equal(cache.get({ ...request, height: 360 }), null);
	assert.equal(cache.get({ ...request, viewport: { ...request.viewport, x: 10 } }), null);
	assert.equal(cache.get({ ...request, targets: {} }), null);
});

test('keeps at most one result and cleanup is idempotent', () => {
	const cache = createVideoPreviewEffectResultCache<object>();
	const first = input();
	const second = input();
	const target = {};
	cache.store(first, {});
	cache.store(second, target);
	assert.equal(cache.get(first), null);
	assert.equal(cache.get(second), target);
	cache.clear();
	cache.clear();
	assert.equal(cache.get(second), null);
});
