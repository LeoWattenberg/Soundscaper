/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const VENDOR_ROOT = join(ROOT, 'vendor/audacity-design-system');

// Rolldown drops the `createContext` import binding of a module whose exports
// nothing reaches, but keeps the bare top-level call, so the boot chunk throws
// `ReferenceError: createContext is not defined` before the editor mounts. The
// `/* @__PURE__ */` annotation lets the call be eliminated with its import. The
// call is side-effect free, so annotating every one of them is always correct —
// and it is the only form that survives an upstream sync adding a new context.
const CREATE_CONTEXT = /(?<annotation>\/\*\s*@__PURE__\s*\*\/\s*)?\bcreateContext\s*[<(]/g;

async function collectSourceFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectSourceFiles(entryPath));
		} else if (/\.tsx?$/.test(entry.name)) {
			files.push(entryPath);
		}
	}
	return files;
}

test('every vendored createContext call is annotated pure so rolldown cannot strand it', async () => {
	const files = await collectSourceFiles(VENDOR_ROOT);
	assert.ok(files.length > 100, 'expected the vendored design-system source tree to be present');

	const unannotated = [];
	let annotated = 0;
	for (const file of files) {
		const source = await readFile(file, 'utf8');
		for (const match of source.matchAll(CREATE_CONTEXT)) {
			// The import statement itself names the symbol without calling it.
			if (/^import\b/m.test(source.slice(source.lastIndexOf('\n', match.index) + 1, match.index))) {
				continue;
			}
			if (match.groups.annotation) {
				annotated += 1;
			} else {
				const line = source.slice(0, match.index).split('\n').length;
				unannotated.push(`${relative(ROOT, file)}:${line}`);
			}
		}
	}

	assert.deepEqual(unannotated, [], 'unannotated createContext calls in the vendored design system');
	assert.ok(annotated > 0, 'expected the scanner to find annotated createContext calls');
});
