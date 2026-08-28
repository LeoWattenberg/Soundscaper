/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import packageJson from '../package.json' with { type: 'json' };

test('the 1.0 candidate is exact and RC tags enter only the preview workflow', async () => {
	assert.equal(packageJson.version, '1.0.0-rc.1');
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /'v\*-beta\.\*'/u);
	assert.match(workflow, /'v\*-rc\.\*'/u);
	assert.match(workflow, /RELEASE_TAG !== 'v' \+ pkg\.version/u);
	assert.match(workflow, /\(\?:beta\|rc\)/u);
	assert.doesNotMatch(workflow, /tags:\s*\n\s*- ['"]v\*['"]/u);
});
