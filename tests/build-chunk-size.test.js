import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_JAVASCRIPT_CHUNK_BYTES,
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
