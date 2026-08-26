import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_FONT_ASSET_BYTES,
	MAX_FONT_ASSET_COUNT,
	MAX_JAVASCRIPT_CHUNK_BYTES,
	findFontInventoryProblems,
	findOversizedJavaScriptChunks,
} from '../scripts/check-build-chunks.mjs';

test('the build chunk guard enforces the exact JavaScript byte ceiling', () => {
	const records = [
		{ path: 'assets/within.js', size: MAX_JAVASCRIPT_CHUNK_BYTES },
		{ path: 'assets/large.js', size: MAX_JAVASCRIPT_CHUNK_BYTES + 1 },
		{ path: 'assets/module.mjs', size: MAX_JAVASCRIPT_CHUNK_BYTES + 10 },
		{ path: 'assets/larger.js', size: MAX_JAVASCRIPT_CHUNK_BYTES + 20 },
		{ path: 'assets/large.css', size: MAX_JAVASCRIPT_CHUNK_BYTES + 50 },
	];

	assert.deepEqual(findOversizedJavaScriptChunks(records), [
		{ path: 'assets/larger.js', size: MAX_JAVASCRIPT_CHUNK_BYTES + 20 },
		{ path: 'assets/module.mjs', size: MAX_JAVASCRIPT_CHUNK_BYTES + 10 },
		{ path: 'assets/large.js', size: MAX_JAVASCRIPT_CHUNK_BYTES + 1 },
	]);
});

test('the build guard accepts only the bounded WOFF2 font inventory', () => {
	const within = Array.from({ length: MAX_FONT_ASSET_COUNT }, (_, index) => ({
		path: `assets/font-${index}.woff2`,
		size: Math.floor(MAX_FONT_ASSET_BYTES / MAX_FONT_ASSET_COUNT),
	}));
	assert.deepEqual(findFontInventoryProblems(within), []);
	assert.deepEqual(findFontInventoryProblems([
		...within,
		{ path: 'assets/legacy.woff', size: 1 },
	]), ['assets/legacy.woff: emitted fonts must be WOFF2']);
	assert.deepEqual(findFontInventoryProblems([
		...within,
		{ path: 'assets/extra.woff2', size: 1 },
	]), [`font count 22 exceeds ${MAX_FONT_ASSET_COUNT}`]);
	assert.deepEqual(findFontInventoryProblems([
		{ path: 'assets/one.woff2', size: MAX_FONT_ASSET_BYTES + 1 },
	]), [`font bytes ${MAX_FONT_ASSET_BYTES + 1} exceed ${MAX_FONT_ASSET_BYTES}`]);
});
