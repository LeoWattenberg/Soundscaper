/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('help remains readable while the pointer crosses from its trigger into the explanation', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Playback\/Recording/u }).click();
	const help = dialog.getByRole('button', { name: 'Help: Keep input devices open between recordings', exact: true });
	await help.hover();
	const tooltip = dialog.getByRole('tooltip');
	await expect(tooltip).toBeVisible();
	const bounds = await tooltip.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + bounds.height / 2, { steps: 20 });
	await expect(tooltip).toBeVisible();
	await page.mouse.move(bounds.x + bounds.width + 30, bounds.y + bounds.height + 30);
	await expect(tooltip).toBeHidden();
	await help.hover();
	await expect(tooltip).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tooltip).toBeHidden();
	await expect(dialog).toBeVisible();
});
