/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('skin browsing preserves modified navigation and ordinary arrow completion', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Appearance$/u }).click();
	const defaultSkin = dialog.getByRole('button', { name: 'Default', exact: true });
	const highContrast = dialog.getByRole('button', { name: 'High-contrast theme', exact: true });
	await defaultSkin.focus();
	await defaultSkin.press('ArrowRight');
	await expect(highContrast).toBeFocused();
	await highContrast.press('Control+End');
	await expect(highContrast).toBeFocused();
	await highContrast.press('Control+ArrowLeft');
	await expect(highContrast).toBeFocused();
	await highContrast.press('Home');
	await expect(defaultSkin).toBeFocused();
	await expect(editor).toHaveAttribute('data-editor-skin', 'default');
});
