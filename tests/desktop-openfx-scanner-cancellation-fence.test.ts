/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the OpenFX scanner checks cancellation at its native spawn boundary', async () => {
	const source = await readFile(new URL('../desktop/openfx-helper-job.ts', import.meta.url), 'utf8');
	const scan = source.slice(source.indexOf('async #scan('), source.indexOf('async #host('));
	assert.match(scan, /await filesystem\.revalidate\(\);\s+signal\.throwIfAborted\(\);\s+const process = this\.#invokeHost/u);
});
