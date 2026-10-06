/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('reaching a skin carousel edge preserves keyboard focus on its navigation action', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Appearance$/u }).click();
	const next = dialog.getByRole('button', { name: 'Next skins', exact: true });
	const previous = dialog.getByRole('button', { name: 'Previous skins', exact: true });
	await expect(next).toBeEnabled();
	await expect(previous).toBeDisabled();
	await next.press('Enter');
	await expect(next).toBeDisabled();
	await expect(previous).toBeEnabled();
	await expect(next).toBeFocused();
	await expect(editor).toHaveAttribute('data-editor-skin', 'default');
	await next.press('Shift+Tab');
	await expect(dialog.getByRole('button', { name: 'Techno', exact: true })).toBeFocused();
});
