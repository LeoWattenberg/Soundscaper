/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { replaceLocalNodeCoverage } from '../scripts/lib/local-coverage-evidence.mjs';

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
