/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('modified source-trim arrows preserve the recording and run the configured command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const clip = clipByName(editor, toneA.name);
	const original = await clip.getAttribute('aria-label');
	const properties = await openClipProperties(page, editor, clip);
	const trim = properties.getByRole('button', { name: 'Trim source start', exact: true });
	await trim.focus();
	await trim.press('Control+Alt+ArrowRight');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(clip).toHaveAttribute('aria-label', original);
});
