/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test('keyboard Record options completion retains the recording keyboard controls', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	const options = editor.getByRole('button', { name: 'Record options', exact: true });
	await options.press('Enter');
	const flyout = page.getByRole('dialog', { name: 'Record options', exact: true });
	const newTrack = flyout.getByRole('button', { name: 'Record to new track', exact: true });
	await expect(newTrack).toBeFocused();
	await newTrack.press('Enter');
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await expect(flyout).toBeHidden();
	await expect(options).toBeFocused();
	await page.keyboard.press('r');
	await expect(record).toHaveAttribute('aria-label', 'Resume recording');
	await page.keyboard.press('r');
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
});
