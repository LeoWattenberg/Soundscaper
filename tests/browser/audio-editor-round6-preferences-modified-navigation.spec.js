/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Preferences sidebar preserves the selected page for modified navigation keys', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const general = preferences.getByRole('tab', { name: /General$/u });
	await general.click();
	for (const chord of ['Control+End', 'Alt+ArrowDown', 'Meta+ArrowRight']) {
		await general.press(chord);
		await expect(general).toHaveAttribute('aria-selected', 'true');
		await expect(general).toBeFocused();
	}
	await general.press('ArrowDown');
	const appearance = preferences.getByRole('tab', { name: /Appearance$/u });
	await expect(appearance).toBeFocused();
	await expect(appearance).toHaveAttribute('aria-selected', 'true');
	await appearance.press('Home');
	await expect(general).toBeFocused();
	await expect(general).toHaveAttribute('aria-selected', 'true');
});
