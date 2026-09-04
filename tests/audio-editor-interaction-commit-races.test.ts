/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('new shortcut rows reconcile controlled input during the layout commit', async () => {
	// The row owns its own fields now that a command can hold several bindings,
	// so the reconciliation lives with the editable entries rather than in the
	// preferences dialog that mounts them.
	const source = await readFile(new URL(
		'../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx',
		import.meta.url,
	), 'utf8');
	assert.match(source, /useLayoutEffect\(\(\) => setEntries\(editableEntries\(persisted\)\), \[persisted\]\);/u);
});

test('dynamic macro roving focus is initialized during the layout commit', async () => {
	// The step list owns the roving group now that the macro library shares the
	// dialog with it, so the open dialog and the chosen macro are implied by the
	// list being mounted at all; only the picker still has to be closed.
	const source = await readFile(new URL(
		'../src/common/editor/ui/inspector/MacroManagerStepList.jsx',
		import.meta.url,
	), 'utf8');
	assert.match(source, /useLayoutEffect\(\(\) => \{\s*if \(!picker\) initTabIndices\(\);/u);
});
