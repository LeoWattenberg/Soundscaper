/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a suspended command leaves modal resize geometry unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	const grip = preferences.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
	await grip.focus();
	const before = await preferences.boundingBox();
	await grip.press('Control+Alt+ArrowUp');
	await expect.poll(async () => (await preferences.boundingBox()).height).toBe(before.height);
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await grip.press('ArrowUp');
	await expect.poll(async () => (await preferences.boundingBox()).height).toBe(Math.round(before.height - 16));
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1).getByRole('slider', { name: /volume$/u });
	await fader.focus();
	await fader.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
