/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('a macro can call Date as a function using its documented virtual clock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		"console.log('Run started:', Date());",
		"sound.assert(Date() === new Date(Date.now()).toString(), 'Use the virtual clock');",
		"console.log('Date call completed');",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toContainText('Date call completed');
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
});
