/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoThumbnailTimestampLookup } from '../src/common/editor/ui/timeline/video-thumbnail-timestamp-index.ts';

void test('thumbnail timestamp lookup preserves first authored matches and strict tolerance without rescanning the catalog', () => {
	let reads = 0;
	const candidates = Array.from({ length: 10_000 }, (_, index) => ({ url: `blob:${index}`, get timestamp() { reads++; return index / 10; } }));
	const lookup = createVideoThumbnailTimestampLookup(candidates)!;
	reads = 0;
	for (let index = 0; index < 100; index++) assert.equal(lookup(index * 9.1)?.url, `blob:${index * 91}`);
	assert.equal(reads, 0, '100 viewport cells perform zero repeated catalog timestamp reads');
	const overlap = [{ timestamp: 1.04, url: 'first' }, { timestamp: 1.01, url: 'second' }, { timestamp: 1.04, url: 'duplicate' }];
	const exact = createVideoThumbnailTimestampLookup(overlap)!;
	for (const value of [0, 0.96, 1, 1.05, 1.09, 2]) assert.equal(exact(value), overlap.find(candidate => Math.abs(candidate.timestamp - value) < 0.05));
});
