/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('new shortcut rows reconcile controlled input during the layout commit', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx',
		import.meta.url,
	), 'utf8');
	assert.match(source, /useLayoutEffect\(\(\) => setBinding\(persisted\), \[persisted\]\);/u);
});

test('dynamic macro roving focus is initialized during the layout commit', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx',
		import.meta.url,
	), 'utf8');
	assert.match(source, /useLayoutEffect\(\(\) => \{\s*if \(isOpen && !selectedEffect && !picker\) initMacroTabIndices\(\);/u);
});
