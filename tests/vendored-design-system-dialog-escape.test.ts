/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DIALOG_URL = new URL(
	'../vendor/audacity-design-system/components/src/Dialog/Dialog.tsx',
	import.meta.url,
);
const DROPDOWN_URL = new URL(
	'../vendor/audacity-design-system/components/src/Dropdown/Dropdown.tsx',
	import.meta.url,
);
const SHELL_URL = new URL('../src/common/editor/ui/AudioEditorDialogShell.tsx', import.meta.url);

test('the Dialog Escape handler runs after the React tree, so an inner overlay can claim the key', async () => {
	const source = await readFile(DIALOG_URL, 'utf8');
	const effect = source.slice(source.indexOf('const handleEscape'), source.indexOf('// Prevent body scroll'));

	assert.match(effect, /document\.addEventListener\('keydown', handleEscape\);/u);
	assert.match(effect, /document\.removeEventListener\('keydown', handleEscape\);/u);
	assert.doesNotMatch(
		effect,
		/(?:add|remove)EventListener\('keydown', handleEscape, true\)/u,
		'a capture-phase listener fires before every inner overlay, so Escape closes the whole dialog',
	);
});

test('an open Dropdown inside a Dialog keeps its Escape defence, which only a bubble-phase listener respects', async () => {
	const dropdown = await readFile(DROPDOWN_URL, 'utf8');

	assert.match(
		dropdown,
		/e\.key === 'Escape' && isOpen\) \{[\s\S]*?e\.stopPropagation\(\);[^\n]*Prevent Dialog from closing/u,
	);
});

test('the vendored Dialog matches the phase the application dialog shell already proves out', async () => {
	const shell = await readFile(SHELL_URL, 'utf8');

	assert.match(shell, /document\.addEventListener\('keydown', handleKeyDown\);/u);
	assert.doesNotMatch(shell, /addEventListener\('keydown', handleKeyDown, true\)/u);
});
