/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DIALOG = new URL(
	'../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx',
	import.meta.url,
);

/**
 * `perform` is fire-and-forget: it resolves the operation asynchronously and
 * reports a rejection through `setError`. A state change applied beside the
 * call therefore survives a refusal, and the dialog rebuilds its model from the
 * automation mode, so a refused mode would drive the gesture controls against a
 * controller still in the previous one.
 */
test('the automation mode is adopted only after the controller accepts it', async () => {
	const source = await readFile(DIALOG, 'utf8');
	const handler = /onMode=\{\(next\) => \{([\s\S]*?)\n\t\t\t\t\t\}\}/u.exec(source);
	assert.ok(handler, 'the mode handler is present');
	const body = handler[1];

	assert.match(body, /perform\('automation-mode'/u);
	assert.match(
		body,
		/\}\)\s*,\s*\(\)\s*=>\s*\{\s*setMode\(next\);\s*\}\)/u,
		'setMode runs as the success callback of the operation',
	);
	assert.doesNotMatch(
		body,
		/\}\)\);\s*\n\s*setMode\(next\);/u,
		'setMode must not run beside the operation, where a refusal cannot undo it',
	);
});
