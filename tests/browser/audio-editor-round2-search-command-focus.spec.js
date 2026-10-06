/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('a compact search command returns keyboard focus after its input is hidden', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const play = editor.getByRole('button', { name: 'Play', exact: true });
	await play.focus();
	await play.press('Control+k');
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await expect(search).toBeFocused();
	await search.fill('select-all');
	const popup = editor.getByRole('listbox', { name: 'Search results', exact: true });
	await expect(popup.getByRole('option', { name: 'Select all Select Ctrl+A', exact: true }))
		.toHaveAttribute('aria-selected', 'true');
	await search.press('Enter');
	await expect(popup).toBeHidden();
	await expect(search).toBeHidden();
	await expect(play).toBeFocused();
	await play.press('Tab');
	await expect(editor.getByRole('button', { name: 'Play options', exact: true })).toBeFocused();
	await page.keyboard.press('Control+k');
	await search.fill('preferences');
	await popup.getByRole('option', { name: /^Preferences Edit /u }).hover();
	await search.press('Enter');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences).toBeVisible();
	await expect.poll(() => preferences.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
});
