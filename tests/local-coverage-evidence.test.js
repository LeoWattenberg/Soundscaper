/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertLocalNodeCoverageStructure,
	replaceLocalNodeCoverage,
} from '../scripts/lib/local-coverage-evidence.mjs';

const PRODUCTION_PATHS = [
	'src/common/editor/model.ts',
	'src/common/editor/controller/edit.ts',
	'desktop/main.mjs',
	'src/framescaper/model.ts',
	'src/soundscaper/model.ts',
	'src/common/transfer/session.ts',
	'src/common/site/route.js',
	'src/common/i18n/runtime.js',
	'src/common/offline/application-shell.ts',
	'src/main.jsx',
];

function nodeCoverageSummary() {
	const uncovered = () => ({ covered: 0, total: 100 });
	return Object.fromEntries(PRODUCTION_PATHS.map((path) => [
		path,
		{ lines: uncovered(), branches: uncovered(), functions: uncovered() },
	]));
}

test('a local Node coverage run cannot inherit a previous browser profile', () => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-local-coverage-'));
	const output = join(directory, 'all');
	try {
		mkdirSync(output);
		writeFileSync(join(output, 'browser-chromium-previous.json'), '{"result":[{"url":"stale"}]}');
		const nodeProfile = { result: [{ url: 'fresh-node' }], 'source-map-cache': {} };
		replaceLocalNodeCoverage(output, nodeProfile);
		assert.deepEqual(readdirSync(output), ['all.json']);
		assert.deepEqual(JSON.parse(readFileSync(join(output, 'all.json'), 'utf8')), nodeProfile);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('local Node coverage accepts low percentages because CI checks the union floors', () => {
	assert.doesNotThrow(() => assertLocalNodeCoverageStructure(nodeCoverageSummary(), '/workspace'));
});

test('local Node coverage rejects an unclassified production file', () => {
	const summary = nodeCoverageSummary();
	summary['src/new-product/model.ts'] = summary['src/main.jsx'];
	assert.throws(
		() => assertLocalNodeCoverageStructure(summary, '/workspace'),
		/Coverage reported unclassified production files: src\/new-product\/model\.ts\./u,
	);
});

test('local Node coverage rejects a missing production scope', () => {
	const summary = nodeCoverageSummary();
	delete summary['src/common/editor/controller/edit.ts'];
	assert.throws(
		() => assertLocalNodeCoverageStructure(summary, '/workspace'),
		/Editor core coverage reported no production files\./u,
	);
});
