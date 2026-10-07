/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test.use({ timezoneId: 'Europe/Berlin' });

test('timed recording refuses a local start time skipped by daylight saving', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const start = dialog.locator('input[type="datetime-local"]').first();
	const schedule = dialog.getByRole('button', { name: 'Schedule recording', exact: true });
	await start.fill('2030-03-31T01:30');
	await expect(schedule).toBeEnabled();
	await start.fill('2030-03-31T02:30');
	await expect(start).toHaveValue('2030-03-31T02:30');
	await expect(schedule).toBeDisabled();
	await expect(start).toHaveAttribute('aria-invalid', 'true');
	await expect(dialog.getByRole('alert')).toHaveText('Enter a date and time that exist in your time zone.');
	await start.fill('2030-03-31T03:30');
	await expect(schedule).toBeEnabled();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('timed recording refuses an explicit end time skipped by daylight saving', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const dates = dialog.locator('input[type="datetime-local"]');
	const schedule = dialog.getByRole('button', { name: 'Schedule recording', exact: true });
	await dates.first().fill('2030-03-31T01:30');
	await dialog.getByRole('radio', { name: 'End date and time', exact: true }).check();
	await dates.nth(1).fill('2030-03-31T02:30');
	await expect(dates.nth(1)).toHaveValue('2030-03-31T02:30');
	await expect(schedule).toBeDisabled();
	await expect(dates.nth(1)).toHaveAttribute('aria-invalid', 'true');
	await expect(dialog.getByRole('alert')).toHaveText('Enter a date and time that exist in your time zone.');
	await dates.nth(1).fill('2030-03-31T03:30');
	await expect(schedule).toBeEnabled();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});
