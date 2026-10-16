/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const [tab, label, saved, draft] of [
	['Editing', 'Mouse zoom precision', '12', '13'],
	['Audio settings', 'Recording offset (ms)', '120', '130'],
	['Track display', 'Low/mid crossover (Hz)', '300', '310'],
]) {
	test(`numeric Preferences preserve the native ${label} composition`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: new RegExp(`${tab}$`, 'u') }).click();
		const field = preferences.getByRole('spinbutton', { name: label, exact: true });
		await field.fill(saved);
		await field.press('Enter');
		await expect(field).toHaveValue(saved);
		await field.fill(draft);
		for (const key of ['Escape', 'Enter']) {
			const prevented = await field.evaluate((input, key) => {
				const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true });
				input.dispatchEvent(event);
				return event.defaultPrevented;
			}, key);
			expect(prevented).toBe(false);
			await expect(field).toHaveValue(draft);
			await expect(field).toBeFocused();
			await expect(preferences).toBeVisible();
		}
		await field.press('Enter');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await preferences.getByRole('tab', { name: new RegExp(`${tab}$`, 'u') }).click();
		await expect(field).toHaveValue(draft);
	});
}
