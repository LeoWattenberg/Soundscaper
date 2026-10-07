/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NODE_TEST_SHARD_IDS, classifyNodeTestFile, parseNodeTestSelection } from '../scripts/lib/node-test-shards.mjs';
import { classifyProductionCoveragePath } from '../scripts/lib/coverage-gates.mjs';

test('Lightscaper owns its product tests while cross-product tests stay common', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightscaper-shard-'));
	mkdirSync(join(root, 'tests'));
	const fixture = (name, source) => {
		const path = join(root, 'tests', name);
		writeFileSync(path, source);
		return path;
	};
	try {
		assert.equal(classifyNodeTestFile(root, fixture('catalog.test.ts', "import '../src/lightscaper/catalog.ts';")), 'lightscaper');
		assert.equal(classifyNodeTestFile(root, fixture('lightscaper-menu.test.ts', '')), 'lightscaper');
		assert.equal(classifyNodeTestFile(root, fixture('handoff.test.ts', "import '../src/lightscaper/catalog.ts'; import '../src/framescaper/project.ts';")), 'common');
		assert.equal(classifyNodeTestFile(root, fixture('lightscaper-soundscaper-handoff.test.ts', '')), 'common');
		assert.ok(NODE_TEST_SHARD_IDS.includes('lightscaper'));
		assert.deepEqual(parseNodeTestSelection(['--shard=lightscaper']), { shard: 'lightscaper' });
		assert.equal(classifyProductionCoveragePath('src/lightscaper/catalog/documents.ts'), 'lightscaper');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
