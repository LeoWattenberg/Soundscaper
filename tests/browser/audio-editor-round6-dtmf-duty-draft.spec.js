/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('editing a DTMF sequence through one symbol retains its authored duty cycle', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const dialog = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	const duty = dialog.locator('[data-generator-field="dutyPercent"] input');
	const sequence = dialog.locator('[data-generator-field="sequence"] input');
	await duty.fill('50');
	await duty.blur();
	await expect(duty).toHaveValue('50');
	await sequence.fill('1');
	await expect(duty).toHaveValue('50');
	await sequence.fill('123');
	await expect(duty).toHaveValue('50');
	await expect(dialog.locator('.kw-audio-editor-generator__timing-summary')).toContainText('6 sec');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
