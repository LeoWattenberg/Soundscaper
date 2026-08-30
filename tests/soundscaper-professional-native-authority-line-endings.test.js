/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('professional native self-test authorities retain Git blob bytes on Windows', async () => {
	const attributes = await readFile(resolve(ROOT, '.gitattributes'), 'utf8');
	const rules = new Set(attributes.split(/\r?\n/u));
	for (const path of [
		'/scripts/self-test-soundscaper-professional-native-runtime.mjs',
		'/scripts/self-test-soundscaper-delivery-fs.mjs',
		'/scripts/lib/soundscaper-professional-packaged-app-authority.mjs',
		'/scripts/lib/soundscaper-native-test-runtime.mjs',
	]) {
		assert(rules.has(`${path} text eol=lf`),
			`${path} must be pinned to LF for byte-for-byte Git authentication`);
	}
});
