/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('editing Zoom precision permits clearing and replacing its saved integer', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	const precision = preferences.getByRole('spinbutton', { name: 'Mouse zoom precision', exact: true });
	await precision.fill('');
	await precision.pressSequentially('3');
	await precision.press('Tab');
	await expect(precision).toHaveValue('3');
});
