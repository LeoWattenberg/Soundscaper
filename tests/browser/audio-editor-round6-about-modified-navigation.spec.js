/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('About tabs leave modified navigation keys available without selecting another tab', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Help', ['About Soundscaper']);
	const dialog = page.getByRole('dialog', { name: 'About Soundscaper', exact: true });
	const about = dialog.getByRole('tab', { name: 'About', exact: true });
	await expect(about).toBeFocused();
	for (const chord of ['Control+End', 'Alt+ArrowRight', 'Meta+ArrowRight']) {
		await about.press(chord);
		await expect(about).toHaveAttribute('aria-selected', 'true');
		await expect(about).toBeFocused();
	}
	await about.press('ArrowRight');
	await expect(dialog.getByRole('tab', { name: 'Contributors', exact: true })).toBeFocused();
	await dialog.getByRole('tab', { name: 'Contributors', exact: true }).press('Home');
	await expect(about).toBeFocused();
});
