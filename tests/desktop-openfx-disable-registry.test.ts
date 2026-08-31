/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OpenFX disable retires revoked session registry entries', async () => {
	const source = await readFile(new URL('../desktop/openfx-main-service.ts', import.meta.url), 'utf8');
	const disable = source.slice(source.indexOf('async disable()'), source.indexOf('async dispose()'));
	assert.match(disable, /await Promise\.all\(disposals\);\s+this\.#plugins\.clear\(\);/u);
});
