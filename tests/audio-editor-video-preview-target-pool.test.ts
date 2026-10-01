/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoPreviewTargetPool } from '../src/common/editor/controller/clip-video/video-preview-target-pool.ts';

test('preview scratch targets allocate once on demand at their required resolution', () => {
	const allocated: string[] = [];
	const released: string[] = [];
	const pool = createVideoPreviewTargetPool({
		width: 3_840, height: 2_160, blurScale: 2 / 3,
		allocate: (width, height) => {
			const target = `${String(width)}x${String(height)}:${String(allocated.length)}`;
			allocated.push(target);
			return target;
		},
		release: (target: string) => { released.push(target); },
	});
	assert.deepEqual(allocated, []);
	const composition = pool.get('composition');
	assert.equal(pool.get('composition'), composition);
	assert.deepEqual(allocated, ['3840x2160:0']);
	pool.get('blurPing');
	assert.deepEqual(allocated, ['3840x2160:0', '2560x1440:1']);
	assert.deepEqual(pool.allocated(), allocated);
	pool.dispose();
	pool.dispose();
	assert.deepEqual(released, allocated);
	assert.throws(() => pool.get('ping'), /disposed/u);
});

test('a failed lazy allocation does not invalidate earlier targets and can be retried', () => {
	let fail = false;
	const pool = createVideoPreviewTargetPool({
		width: 640, height: 360, blurScale: 0.5,
		allocate: () => {
			if (fail) throw new Error('allocation failed');
			return {};
		},
		release: () => undefined,
	});
	const composition = pool.get('composition');
	fail = true;
	assert.throws(() => pool.get('ping'), /allocation failed/u);
	assert.equal(pool.get('composition'), composition);
	assert.deepEqual(pool.allocated(), [composition]);
	fail = false;
	assert.notEqual(pool.get('ping'), composition);
	assert.equal(pool.allocated().length, 2);
	pool.dispose();
});
