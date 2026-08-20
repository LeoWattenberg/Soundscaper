/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyEditorCommand } from '../src/common/editor/commands.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_ROOT = path.join(REPOSITORY_ROOT, 'src/common/editor');
const RETIRED_PROJECT_MODULE = /^project-v(?:[2-9]|1[0-6])(?:[.-])/u;
const RETIRED_PROJECT_IMPORT = /(?:from\s+|import\s*\()['"][^'"]*project-v(?:[2-9]|1[0-6])(?:[./-])/u;

test('retired pre-release project generations are absent from the editor implementation', async () => {
	const entries = await readdir(EDITOR_ROOT, { withFileTypes: true });
	const retired = entries
		.filter((entry) => entry.isFile() && RETIRED_PROJECT_MODULE.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(retired, []);
});

test('production source imports no retired pre-release project generation', async () => {
	const sourceFiles = await sourceFilesUnder(path.join(REPOSITORY_ROOT, 'src'));
	const violations: string[] = [];
	for (const file of sourceFiles) {
		const source = await readFile(file, 'utf8');
		if (RETIRED_PROJECT_IMPORT.test(source)) {
			violations.push(path.relative(REPOSITORY_ROOT, file));
		}
	}
	assert.deepEqual(violations, []);
});

test('the shared command boundary rejects every retired raw-project schema', () => {
	for (let schemaVersion = 2; schemaVersion <= 16; schemaVersion += 1) {
		assert.throws(
			() => applyEditorCommand({ schemaVersion } as never, { type: 'track/remove', trackId: 'track' }),
			/current audio editor project/iu,
		);
	}
});

async function sourceFilesUnder(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await sourceFilesUnder(file));
		else if (/\.(?:js|jsx|mjs|ts|tsx)$/u.test(entry.name)) result.push(file);
	}
	return result.sort();
}
