/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Risset Drum retains a decimal amplitude typed through its ordinary numeric field', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
	const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
	const amplitude = dialog.getByRole('spinbutton', { name: 'Amplitude (0 - 1)', exact: true });
	await amplitude.fill('');
	await amplitude.pressSequentially('0.5');
	await amplitude.press('Tab');
	await expect(amplitude).toHaveValue('0.5');
});

test('Adjustable Fade retains a typed negative fractional curve', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Adjustable Fade']);
	const dialog = page.getByRole('dialog', { name: 'Adjustable Fade', exact: true });
	const curve = dialog.getByRole('spinbutton', { name: 'Mid-fade Adjust (%)', exact: true });
	await curve.fill('');
	await curve.pressSequentially('-0.5');
	await curve.press('Tab');
	await expect(curve).toHaveValue('-0.5');
});
