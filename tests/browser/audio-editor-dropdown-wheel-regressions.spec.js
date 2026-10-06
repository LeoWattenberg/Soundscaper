/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, openExportDialog, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('effect preset dropdown permits wheel scrolling to a later visible choice', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb (Audacity)']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	const menu = page.getByRole('listbox', { name: 'Preset', exact: true });
	await menu.hover({ position: { x: 12, y: 20 } });
	await page.mouse.wheel(0, 800);
	const cathedral = page.getByRole('option', { name: 'Cathedral', exact: true });
	await expect(cathedral).toBeInViewport({ ratio: 1 });
	await cathedral.click();
	await expect(dialog.getByRole('group', { name: /^Room size(?: \(.*\))?$/u }).getByRole('spinbutton')).toHaveValue('90');
});

test('export format dropdown permits wheel scrolling to MP2 before clicking it', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	const dialog = await openExportDialog(page, editor);
	const format = dialog.getByRole('group', { name: 'Format', exact: true }).getByRole('button');
	await format.click();
	const menu = page.getByRole('listbox', { name: 'Format', exact: true });
	await menu.hover({ position: { x: 12, y: 20 } });
	await page.mouse.wheel(0, 800);
	const mp2 = page.getByRole('option', { name: 'MP2', exact: true });
	await expect(mp2).toBeInViewport({ ratio: 1 });
	await mp2.click();
	await expect(format).toContainText('MP2');
});
