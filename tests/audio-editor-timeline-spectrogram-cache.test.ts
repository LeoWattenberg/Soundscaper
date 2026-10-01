/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineSpectrogramCache } from '../src/common/editor/controller/source/timeline-spectrogram-cache.ts';

test('spectrogram analysis and pixels have independent identities and memory budgets', () => {
	const released: object[] = [];
	const cache = createTimelineSpectrogramCache<object>({
		analysisByteBudget: 256, pixelByteBudget: 256, releaseImage: (image) => { released.push(image); },
	});
	const owner = {};
	const source = {};
	let analyses = 0;
	let paints = 0;
	const analyze = () => { analyses += 1; return [[[0.1, 0.2]]]; };
	const paint = () => { paints += 1; return {}; };
	const columns = cache.analysis(owner, [source, 64, 'hann'], analyze);
	assert.ok(columns);
	assert.strictEqual(cache.analysis(owner, [source, 64, 'hann'], analyze), columns);
	const image = cache.image(owner, [columns, 20, 80], 8, 4, paint);
	assert.strictEqual(cache.image(owner, [columns, 20, 80], 8, 4, paint), image);
	assert.equal(analyses, 1);
	assert.equal(paints, 1);
	cache.image(owner, [columns, 40, 80], 8, 4, paint);
	assert.equal(paints, 2, 'gain repaints pixels');
	assert.equal(analyses, 1, 'gain reuses FFT results');
	assert.deepEqual(released, [image]);
	assert.notStrictEqual(cache.analysis(owner, [source, 128, 'hann'], analyze), columns);
	assert.equal(analyses, 2, 'FFT size changes analysis');
	cache.release(owner);
	cache.release(owner);
	assert.equal(cache.snapshot().analysisBytes, 0);
	assert.equal(cache.snapshot().pixelBytes, 0);
	assert.equal(released.length, 2, 'release is idempotent');
});

test('spectrogram caches evict least recently used owners and reject oversized pixels before painting', () => {
	const released: object[] = [];
	const cache = createTimelineSpectrogramCache<object>({
		analysisByteBudget: 128, pixelByteBudget: 128, releaseImage: (image) => { released.push(image); },
	});
	const first = {};
	const second = {};
	const third = {};
	const firstImage = cache.image(first, [], 4, 4, () => ({}));
	cache.image(second, [], 4, 4, () => ({}));
	assert.strictEqual(cache.image(first, [], 4, 4, () => assert.fail('cache hit repainted')), firstImage);
	cache.image(third, [], 4, 4, () => ({}));
	assert.equal(released.length, 1);
	assert.notStrictEqual(released[0], firstImage, 'the recently used image survives');
	assert.equal(cache.image({}, [], 100, 100, () => assert.fail('oversized image allocated')), null);
	for (const owner of [first, second, third]) cache.analysis(owner, [], () => [[[0.1, 0.2]]]);
	assert.ok(cache.snapshot().analysisBytes <= 128);
	assert.ok(cache.snapshot().pixelBytes <= 128);
	cache.dispose();
	cache.dispose();
	assert.equal(cache.snapshot().pixelBytes, 0);
	assert.equal(cache.snapshot().analysisBytes, 0);
});

test('unavailable FFT analysis and unsuccessful painting are retried', () => {
	const cache = createTimelineSpectrogramCache<object>({ releaseImage: () => {} });
	const owner = {};
	assert.equal(cache.analysis(owner, [], () => null), null);
	assert.deepEqual(cache.analysis(owner, [], () => [[[0.5]]]), [[[0.5]]]);
	assert.equal(cache.image(owner, [], 4, 4, () => null), null);
	assert.ok(cache.image(owner, [], 4, 4, () => ({})));
});
