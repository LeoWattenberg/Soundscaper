/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpectrogramColumnCache } from '../src/common/editor/controller/source/internal/spectrogram-column-cache.ts';
import { timelineSpectrogramColumnCache } from '../src/common/editor/controller/source/timeline-spectrogram-cache.ts';

test('identically named source revisions from separate controllers do not share spectral bytes', () => {
	const firstOwner = {};
	const secondOwner = {};
	const first = timelineSpectrogramColumnCache(firstOwner, 'same-source');
	const second = timelineSpectrogramColumnCache(secondOwner, 'same-source');
	first.write(0, [[1]]);
	assert.equal(second.read(0), null);
	assert.deepEqual(timelineSpectrogramColumnCache(firstOwner, 'same-source').read(0), [[1]]);
	second.write(0, [[2]]);
	assert.deepEqual(first.read(0), [[1]]);
	assert.deepEqual(second.read(0), [[2]]);
});

test('shared spectral columns evict least recently read entries within the byte budget', () => {
	const cache = createSpectrogramColumnCache(480);
	const first = cache.forKey('first');
	const second = cache.forKey('second');
	const bands = [[0.1, 0.2]];
	first.write(10, bands);
	first.write(20, bands);
	assert.equal(first.read(10), bands);
	second.write(30, bands);
	assert.equal(first.read(20), null, 'a hot column survives the newer namespace');
	assert.equal(first.read(10), bands);
	assert.equal(second.read(30), bands);
	assert.ok(cache.snapshot().bytes <= 480);
	assert.equal(cache.snapshot().entries, 2);
	cache.clear();
	assert.deepEqual(cache.snapshot(), { bytes: 0, entries: 0, namespaces: 0 });
	assert.equal(first.read(10), null, 'views do not retain evicted arrays');
});

test('spectral namespace keys and oversized columns count against the bound', () => {
	const cache = createSpectrogramColumnCache(400);
	cache.forKey('x'.repeat(200)).write(0, [[1]]);
	assert.equal(cache.snapshot().entries, 0);
	cache.forKey('x').write(0, [Array.from({ length: 100 }, () => 1)]);
	assert.equal(cache.snapshot().entries, 0);
	cache.forKey('x').write(0, [[1]]);
	assert.equal(cache.snapshot().entries, 1);
	cache.forKey('x').write(0, [[2]]);
	assert.deepEqual(cache.forKey('x').read(0), [[2]]);
	assert.equal(cache.snapshot().entries, 1);
	assert.ok(cache.snapshot().bytes <= 400);
});

test('eviction releases empty namespace accounting and preserves identity boundaries', () => {
	const cache = createSpectrogramColumnCache(256);
	cache.forKey('source-v1').write(0, [[1]]);
	cache.forKey('source-v2').write(0, [[2]]);
	assert.equal(cache.forKey('source-v1').read(0), null);
	assert.deepEqual(cache.forKey('source-v2').read(0), [[2]]);
	assert.equal(cache.snapshot().namespaces, 1);
	assert.throws(() => createSpectrogramColumnCache(-1), RangeError);
});
