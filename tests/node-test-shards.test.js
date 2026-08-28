/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test, { after } from 'node:test';

import {
	NODE_TEST_SHARD_IDS,
	classifyNodeTestFile,
	classifyNodeTestFiles,
	listNodeTestFiles,
	parseNodeTestSelection,
	selectNodeTestFiles,
} from '../scripts/lib/node-test-shards.mjs';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');
const SHARDED_WORKFLOWS = ['quality.yml', 'desktop-preview.yml'];
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('every Node test file belongs to exactly one shard', () => {
	const everyTestFile = listNodeTestFiles(ROOT);
	assert.ok(everyTestFile.length > 0, 'expected the suite to discover test files');

	const sharded = NODE_TEST_SHARD_IDS.flatMap((shard) => selectNodeTestFiles(ROOT, { shard }));
	assert.deepEqual(
		[...sharded].sort(),
		everyTestFile,
		'the shards must partition the suite: a file in none of them is a test CI silently stops running',
	);
	assert.equal(new Set(sharded).size, sharded.length, 'no test file may run in two shards');
});

test('no Node test hides in a subdirectory where no shard would find it', async () => {
	// Discovery reads tests/ itself, while tsconfig.tests.json includes
	// tests/**/*.test.ts. A nested test would therefore typecheck, look maintained,
	// and never be run by any job.
	const nested = (await readdir(new URL('../tests/', import.meta.url), { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.parentPath !== undefined)
		.filter((entry) => /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u.test(entry.name) && entry.parentPath.replace(/\/$/u, '').endsWith('/tests') === false)
		.map((entry) => `${entry.parentPath}/${entry.name}`);
	assert.deepEqual(nested, [], 'move it up into tests/, or the shards will silently stop running it');
});

test('a test is shelved with the product whose own tree it reaches into', () => {
	const shards = classifyNodeTestFiles(ROOT);
	const named = (shard, name) => shards.get(shard).some((file) => basename(file) === name);

	assert.ok(
		named('framescaper', 'audio-editor-framescaper-capture-domain.test.ts'),
		'a test importing src/framescaper belongs to the Framescaper shard',
	);
	assert.ok(
		named('soundscaper', 'audio-editor-soundscaper-baseline.test.ts'),
		'a test importing src/soundscaper belongs to the Soundscaper shard',
	);
	assert.ok(
		named('common', 'audio-editor-mastering-sequence-capability.test.ts'),
		'a test reaching into both products is cross-product work and belongs to the shared shard',
	);
	assert.ok(
		named('common', 'quality-budgets.test.ts'),
		'a test that reaches into neither product belongs to the shared shard',
	);
});

test('shard classification does not follow the shared tree into either product', () => {
	// src/common/editor imports from both products (the lazy product bootstraps in
	// src/common/site/App.jsx, the Framescaper dialog models, the Soundscaper
	// longform workload). Following those would put every test in one shard.
	const sharedOnly = listNodeTestFiles(ROOT).filter(
		(file) => basename(file) === 'audio-editor-clip-property-service.test.ts',
	);
	assert.equal(sharedOnly.length, 1, 'expected the shared clip-property test to exist');
	assert.equal(classifyNodeTestFile(ROOT, sharedOnly[0]), 'common');
});

test('a product reference reached only through a helper still shelves the test', () => {
	// Helpers are written in both module styles, so the closure has to see `import`
	// and `require` alike. A missed helper silently demotes the test to `common`,
	// where a Framescaper regression stops being visible in the Framescaper job.
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-shard-closure-'));
	workspaces.push(root);
	mkdirSync(join(root, 'tests/helpers'), { recursive: true });
	writeFileSync(join(root, 'tests/helpers/imported.ts'), "export { thing } from '../../src/framescaper/thing.ts';\n");
	writeFileSync(join(root, 'tests/helpers/required.js'), "module.exports = require('../../src/framescaper/other.js');\n");

	for (const [name, source] of [
		['imports.test.ts', "import { thing } from './helpers/imported.ts';\n"],
		['requires.test.js', "const helper = require('./helpers/required.js');\n"],
	]) {
		writeFileSync(join(root, 'tests', name), source);
		assert.equal(classifyNodeTestFile(root, join(root, 'tests', name)), 'framescaper', name);
	}
});

test('no test file names both products, so the filename signal is never ambiguous', () => {
	// A test is also shelved by its own name, because roughly a hundred Framescaper
	// modules live under src/common/editor and a test of those reaches no product
	// tree at all. That signal only stays honest while no filename claims both.
	const ambiguous = listNodeTestFiles(ROOT)
		.map((file) => basename(file))
		.filter((name) => name.includes('framescaper') && name.includes('soundscaper'));
	assert.deepEqual(ambiguous, [], 'rename such a test after the product that owns it, or after neither');
});

test('the shard selection CLI accepts the shard ids and refuses anything else', () => {
	assert.deepEqual(parseNodeTestSelection([]), { shard: null });
	for (const shard of NODE_TEST_SHARD_IDS) {
		assert.deepEqual(parseNodeTestSelection([`--shard=${shard}`]), { shard });
	}
	assert.throws(() => parseNodeTestSelection(['--shard=everything']), /Unknown test shard/u);
	assert.throws(() => parseNodeTestSelection(['--stripe=1/4']), /Unknown test selection argument/u);
});

for (const workflowName of SHARDED_WORKFLOWS) {
	test(`${workflowName} runs one job per shard and no more`, async () => {
		const job = extractJob(await readWorkflow(workflowName), 'tests');
		const matrix = /shard: \[([^\]]+)\]/u.exec(job)?.[1];
		assert.ok(matrix, `${workflowName} must drive its test jobs from a shard matrix`);
		assert.deepEqual(
			matrix.split(',').map((entry) => entry.trim()).sort(),
			[...NODE_TEST_SHARD_IDS].sort(),
			`${workflowName} must run every shard the classifier can produce, and only those`,
		);
		assert.match(
			job,
			/npm run test:shard -- --shard=\$\{\{ matrix\.shard \}\} --require-linux-native/u,
			`${workflowName} must turn native prerequisite skips into failures`,
		);
	});
}
