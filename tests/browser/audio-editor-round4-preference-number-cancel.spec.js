/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Escape cancels a bounded preference number draft before closing Preferences', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	const precision = preferences.getByRole('spinbutton', { name: 'Mouse zoom precision', exact: true });
	const saved = await precision.inputValue();
	await precision.fill('12');
	await precision.press('Escape');
	await expect(preferences).toBeVisible();
	await expect(precision).toHaveValue(saved);
	await precision.press('Tab');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await expect(precision).toHaveValue(saved);
	await precision.fill('12');
	await precision.press('Enter');
	await expect(precision).toHaveValue('12');
	await precision.focus();
	await precision.press('Escape');
	await expect(preferences).toBeHidden();
});

test('Escape cancels a waveform crossover draft without publishing its following blur', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const crossover = preferences.getByRole('spinbutton', { name: 'Low/mid crossover (Hz)', exact: true });
	await expect(crossover).toHaveValue('250');
	await crossover.fill('300');
	await crossover.press('Escape');
	await expect(preferences).toBeVisible();
	await expect(crossover).toHaveValue('250');
	await crossover.press('Tab');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	await expect(crossover).toHaveValue('250');
});
