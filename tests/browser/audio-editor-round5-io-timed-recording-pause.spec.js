/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('pausing a timed recording retains the chosen absolute end date', async ({ page }) => {
	test.setTimeout(60_000);
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const start = new Date(Date.now() + 8_000);
	start.setMilliseconds(0);
	const end = new Date(start.getTime() + 8_000);
	const localValue = date => new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString().slice(0, 19).replace(/:00$/u, '');
	await dialog.locator('input[type="datetime-local"]').first().fill(localValue(start));
	await dialog.getByRole('radio', { name: 'End date and time', exact: true }).check();
	await dialog.locator('input[type="datetime-local"]').nth(1).fill(localValue(end));
	await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
	const active = editor.getByRole('region', { name: 'Recording', exact: true });
	await expect(active).toBeVisible({ timeout: 20_000 });
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await expect(record).toHaveAccessibleName('Pause recording');
	await record.click();
	await expect(record).toHaveAccessibleName('Resume recording');
	const pauseTime = Date.now();
	await expect.poll(() => Date.now(), { timeout: 5_000 }).toBeGreaterThan(pauseTime + 3_000);
	await record.click();
	await expect(record).toHaveAccessibleName('Pause recording');
	await expect.poll(() => Date.now(), { timeout: 15_000 }).toBeGreaterThan(end.getTime() + 350);
	await expect(active).toBeHidden({ timeout: 500 });
	await expect(record).toHaveAttribute('aria-pressed', 'false');
});
