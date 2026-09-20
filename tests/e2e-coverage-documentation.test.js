/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the E2E coverage handoff documents and exposes the strict union workflow', async () => {
	const [documentation, packageMetadata, technicalReadme] = await Promise.all([
		readFile(new URL('../docs/end-to-end-coverage.md', import.meta.url), 'utf8'),
		readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../Technical_README.md', import.meta.url), 'utf8'),
	]);

	assert.equal(
		packageMetadata.scripts['coverage:e2e:assemble'],
		'node scripts/assemble-e2e-coverage.mjs',
	);
	assert.equal(
		packageMetadata.scripts['coverage:e2e:prepare'],
		'node scripts/prepare-e2e-coverage.mjs',
	);
	assert.equal(
		packageMetadata.scripts['coverage:e2e:check'],
		'node scripts/check-e2e-coverage.mjs',
	);
	for (const phrase of [
		'`coverage/v8-browser/`',
		'`coverage/v8-packaged/`',
		'`coverage/build-evidence/`',
		'lines, statements, functions, and branches',
		'Node and unit-test coverage is separate',
		'same full Git revision',
		'identical executable evidence and normalized source maps',
		'digest-authenticated installed paths',
		'npm run coverage:e2e:assemble',
		'npm run coverage:e2e:prepare',
		'npm run coverage:e2e:check',
	]) assert.ok(documentation.includes(phrase), `${phrase} is not documented`);
	assert.match(technicalReadme, /\[end-to-end coverage\]\(docs\/end-to-end-coverage\.md\)/u);
});
