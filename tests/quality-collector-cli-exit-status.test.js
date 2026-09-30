import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const COLLECTORS = [
	'collect-m3-longform-editorial-quality.mjs',
	'collect-m4-production-parity-quality.mjs',
	'collect-m4b2-keyframe-parity-quality.mjs',
];

const SHARED_RUNTIME_COLLECTORS = [
	'collect-m5-native-helper-quality.mjs',
	'collect-m6-reference-master-quality.mjs',
	'collect-m7-local-assistance-privacy-quality.mjs',
	'collect-m8a-capture-quality.mjs',
];

const SHARED_RUNTIME_USAGE = Object.freeze({
	'collect-m5-native-helper-quality.mjs': 'Usage: node scripts/collect-m5-native-helper-quality.mjs --measurement <record.json> [output-directory]\n',
	'collect-m6-reference-master-quality.mjs': 'Usage: node scripts/collect-m6-reference-master-quality.mjs --measurement <record.json> [output-directory]\n',
	'collect-m7-local-assistance-privacy-quality.mjs': 'Usage: node scripts/collect-m7-local-assistance-privacy-quality.mjs --measurement <record.json> [output-directory]\n',
	'collect-m8a-capture-quality.mjs': 'Usage: node scripts/collect-m8a-capture-quality.mjs --measurement <record.json> [output-directory]\n',
});

test('quality collector CLIs fail exactly when their result status is failed', async () => {
	for (const name of COLLECTORS) {
		const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
		assert.match(
			source,
			/if \(collected\.result\.status === 'failed'\) process\.exitCode = 1;/u,
			name,
		);
	}
	const runtime = await readFile(
		new URL('../scripts/lib/quality-collector-runtime.mjs', import.meta.url),
		'utf8',
	);
	assert.match(
		runtime,
		/if \(collected\.result\.status === 'failed'\) setExitCode\(1\);/u,
		'shared quality collector runtime',
	);
	for (const name of SHARED_RUNTIME_COLLECTORS) {
		const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
		assert.match(source, /await runQualityCollectorMain\(/u, name);
	}
});

test('shared quality collector CLIs retain their exact missing-measurement contract', () => {
	for (const name of SHARED_RUNTIME_COLLECTORS) {
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))],
			{ encoding: 'utf8' },
		);
		assert.equal(result.status, 2, name);
		assert.equal(result.stdout, '', name);
		assert.equal(result.stderr, SHARED_RUNTIME_USAGE[name], name);
	}
});
