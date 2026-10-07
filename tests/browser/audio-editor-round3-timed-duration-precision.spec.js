/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('timed recording preserves milliseconds when switching from duration to an end date', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const dates = dialog.locator('input[type="datetime-local"]');
	await dates.first().fill('2030-01-02T03:04:05');
	const duration = dialog.getByRole('group', { name: 'Duration', exact: true });
	await duration.locator('.timecode-digit').nth(1).click();
	await page.keyboard.type('0');
	await duration.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('500');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('000001500');
	await dialog.getByRole('radio', { name: 'End date and time', exact: true }).check();
	await expect(dates.nth(1)).toBeEnabled();
	await expect.poll(async () => new Date(await dates.nth(1).inputValue()).getTime()
		- new Date(await dates.first().inputValue()).getTime()).toBe(1_500);
	await expect.poll(() => dates.nth(1).evaluate(input => input.validity.stepMismatch)).toBe(false);
	await dialog.getByRole('radio', { name: 'Duration', exact: true }).check();
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('000001500');
});
