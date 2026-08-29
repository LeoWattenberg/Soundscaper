/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The editor's file pickers, and the retry they have to survive.
 *
 * A file input raises `change` only when its value changes, so a picker left
 * holding the previous selection silently ignores the same file being chosen
 * again. That is the retry someone makes after an import reports a failure, and
 * two Inspector pickers used to drop it: the macro importer never cleared its
 * control, and the effect-preset importer cleared it only once an import had
 * already succeeded.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	takeSelectedFile,
	takeSelectedFiles,
} from '../src/common/editor/ui/file-input-selection.ts';

const INSPECTOR_DIRECTORY = new URL('../src/common/editor/ui/inspector/', import.meta.url);

function picker(names: readonly string[], value = 'C:\\fakepath\\chosen'): {
	files: { name: string }[];
	value: string;
} {
	return { files: names.map((name) => ({ name })), value };
}

test('reading a picker hands back the selection and re-arms the control', () => {
	const input = picker(['first.txt', 'second.txt']);

	const files = takeSelectedFiles(input as unknown as HTMLInputElement);

	assert.deepEqual(files.map(({ name }) => name), ['first.txt', 'second.txt']);
	assert.equal(input.value, '', 'an unchanged value raises no second change event');
});

test('a picker is re-armed even when the import that follows it fails', async () => {
	const input = picker(['broken.json']);
	const attempts: string[] = [];
	const importPreset = async (file: File | null): Promise<void> => {
		if (!file) return;
		attempts.push(file.name);
		throw new Error('The preset is not valid JSON.');
	};

	await assert.rejects(importPreset(takeSelectedFile(input as unknown as HTMLInputElement)));
	assert.equal(input.value, '', 'the retry after a failed import must still raise change');

	input.files = [{ name: 'broken.json' }];
	input.value = 'C:\\fakepath\\chosen';
	await assert.rejects(importPreset(takeSelectedFile(input as unknown as HTMLInputElement)));
	assert.deepEqual(attempts, ['broken.json', 'broken.json']);
});

test('an empty or absent picker yields nothing and still clears', () => {
	const empty = picker([]);
	assert.equal(takeSelectedFile(empty as unknown as HTMLInputElement), null);
	assert.equal(empty.value, '');

	const unset = { files: null, value: 'C:\\fakepath\\chosen' };
	assert.deepEqual(takeSelectedFiles(unset as unknown as HTMLInputElement), []);
	assert.equal(unset.value, '');

	assert.deepEqual(takeSelectedFiles(null), []);
	assert.equal(takeSelectedFile(undefined), null);
});

test('every Inspector file picker is read through the re-arming helper', async () => {
	const moduleNames = (await readdir(INSPECTOR_DIRECTORY))
		.filter((name) => /\.(?:jsx|tsx)$/.test(name));
	const pickers: string[] = [];
	for (const moduleName of moduleNames) {
		const source = await readFile(new URL(moduleName, INSPECTOR_DIRECTORY), 'utf8');
		if (!/type="file"/.test(source)) continue;
		pickers.push(moduleName);
		assert.match(
			source,
			/takeSelectedFiles?\(/,
			`${moduleName} renders a file input, so it must read it through takeSelectedFile(s)`,
		);
	}
	assert.ok(pickers.length >= 3, `expected the known Inspector pickers, saw ${JSON.stringify(pickers)}`);
});
