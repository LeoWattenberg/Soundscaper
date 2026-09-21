/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioWorkletLoadOnce } from '../src/common/editor/audio-worklet-load-once.ts';

test('AudioWorklet load-once lifecycle shares work, caches success, and retries failure', async () => {
	let resolveFirstLoad!: () => void;
	const firstLoad = new Promise<void>((resolve) => {
		resolveFirstLoad = resolve;
	});
	let attempts = 0;
	const loader = createAudioWorkletLoadOnce(async () => {
		attempts += 1;
		if (attempts === 1) throw new Error('temporary module failure');
		if (attempts === 2) await firstLoad;
	});
	const context = {} as BaseAudioContext;

	await assert.rejects(Promise.all([loader.ensure(context), loader.ensure(context)]), /temporary module failure/u);
	assert.equal(attempts, 1);
	assert.equal(loader.isLoaded(context), false);

	const first = loader.ensure(context);
	const second = loader.ensure(context);
	assert.equal(attempts, 2);
	assert.equal(loader.isLoaded(context), false);
	resolveFirstLoad();
	await Promise.all([first, second]);
	assert.equal(loader.isLoaded(context), true);

	await loader.ensure(context);
	assert.equal(attempts, 2);
});

test('AudioWorklet load-once lifecycle converts synchronous throws into retryable rejections', async () => {
	let attempts = 0;
	const loader = createAudioWorkletLoadOnce(() => {
		attempts += 1;
		if (attempts === 1) throw 'module factory failed';
	});
	const context = {} as BaseAudioContext;

	await assert.rejects(loader.ensure(context), (error: unknown) => error === 'module factory failed');
	await loader.ensure(context);
	assert.equal(attempts, 2);
	assert.equal(loader.isLoaded(context), true);
});
