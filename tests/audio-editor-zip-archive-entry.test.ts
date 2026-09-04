/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const ARCHIVE_MODULES = [
	'src/common/editor/dawproject-archive.ts',
	'src/common/editor/scape-archive-reader.ts',
	'src/common/editor/scape-export-destination.ts',
	'src/common/editor/scape-project.js',
];

// zip.js's default entry registers an inline worker that instantiates its
// deflate WebAssembly from a `data:application/wasm` URL. The shipped policy
// carries no `data:` in `connect-src`, so every archive the editor opened
// logged a refused connection before falling back. The native entry uses the
// browser's own compression streams and fetches nothing.
test('archive modules take zip.js through its native entry', async () => {
	for (const name of ARCHIVE_MODULES) {
		const source = await readFile(resolve(ROOT, name), 'utf8');
		assert.match(source, /from '@zip\.js\/zip\.js\/index-native\.js'/u, name);
		assert.doesNotMatch(source, /from '@zip\.js\/zip\.js'/u, name);
	}
});
