/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('an ordinary macro helper error points to the authored throw rather than its caller', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'function checkSelection() {',
		"  throw new Error('Choose an audio region first.');",
		'}',
		'checkSelection();',
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const failure = manager.locator('[data-macro-script-failure]');
	await expect(failure).toContainText('Choose an audio region first.');
	await expect(failure).toContainText('line 2:');
});
