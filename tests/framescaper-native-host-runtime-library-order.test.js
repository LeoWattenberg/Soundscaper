/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('native host runtime-library audits use deterministic code-unit order', async () => {
	for (const path of [
		'scripts/lib/framescaper-openfx-host-build.mjs',
		'scripts/lib/framescaper-media-host-build.mjs',
	]) {
		const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
		assert.match(source, /compareCodeUnits\([^\n]+, path\) >= 0/u, path);
		assert.doesNotMatch(source, /localeCompare/u, path);
	}
});
