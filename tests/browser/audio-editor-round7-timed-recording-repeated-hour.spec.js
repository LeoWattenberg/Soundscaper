/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test.use({ timezoneId: 'Europe/Berlin' });

test('timed recording preserves its duration after choosing an end inside a repeated hour', async ({ page }) => {
	const clientErrors = collectClientErrors(page);
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const openTimedRecording = async () => {
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Timed recording', exact: true }).click();
		await expect(dialog).toBeVisible();
	};
	for (const day of ['26', '27']) {
		await openTimedRecording();
		const dates = dialog.locator('input[type="datetime-local"]');
		await dates.first().fill(`2030-10-${day}T01:30`);
		const duration = dialog.getByRole('group', { name: 'Duration', exact: true });
		await duration.locator('.timecode-digit').nth(1).click();
		await page.keyboard.type('2');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).join('')).toBe('020000000');
		await expect(dates.nth(1)).toHaveValue(`2030-10-${day}T0${day === '26' ? '3' : '2'}:30`);
		await dialog.getByRole('radio', { name: 'End date and time', exact: true }).check();
		await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Cancel scheduled recording', exact: true })).toBeVisible();
		await openTimedRecording();
		await expect.poll(async () => (await dialog.getByRole('group', { name: 'Duration', exact: true })
			.locator('.timecode-digit').allTextContents()).join('')).toBe('020000000');
		await dialog.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
		await expect(dialog).toBeHidden();
	}
	expect(clientErrors).toEqual([]);
});
