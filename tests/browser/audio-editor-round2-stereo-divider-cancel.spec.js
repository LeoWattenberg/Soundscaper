/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Escape restores a stereo divider drag before pointer release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('radiogroup', { name: 'Asymmetric stereo heights', exact: true })
		.getByRole('radio', { name: 'Always', exact: true }).check();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const divider = editor.locator('[data-stereo-channel-divider]').last();
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	const box = await divider.boundingBox();
	await page.mouse.move(box.x + 50, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 50, box.y + box.height / 2 + 24, { steps: 4 });
	await expect(divider).not.toHaveAttribute('aria-valuenow', '50');
	await page.keyboard.press('Escape');
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await page.mouse.up();
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
});
