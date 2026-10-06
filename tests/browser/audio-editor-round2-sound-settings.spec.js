/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('sound activation sliders retain focus between ordinary keyboard adjustments', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const options = page.getByRole('dialog', { name: 'Record options', exact: true });
	await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
	const threshold = settings.getByRole('slider', { name: 'Activation threshold', exact: true });
	await threshold.focus();
	await threshold.press('ArrowRight');
	await expect(threshold).toHaveValue('-39');
	await expect(threshold).toBeEnabled();
	await expect(threshold).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(threshold).toHaveValue('-38');
});
