import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const COLLECTORS = [
	'collect-m3-longform-editorial-quality.mjs',
	'collect-m4-production-parity-quality.mjs',
	'collect-m4b2-keyframe-parity-quality.mjs',
	'collect-m5-native-helper-quality.mjs',
];

test('quality collector CLIs fail exactly when their result status is failed', async () => {
	for (const name of COLLECTORS) {
		const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
		assert.match(
			source,
			/if \(collected\.result\.status === 'failed'\) process\.exitCode = 1;/u,
			name,
		);
	}
});
