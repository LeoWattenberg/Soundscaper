import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Tech 3341 burst fixtures audit the maximum reached loudness', async () => {
	const source = await readFile(new URL('../scripts/audit-ebu-r128.mjs', import.meta.url), 'utf8');

	assert.match(source, /number === 9\) return symmetric\('maximumShortTermLufs'/u);
	assert.match(source, /number === 12\) return symmetric\('maximumMomentaryLufs'/u);
});
