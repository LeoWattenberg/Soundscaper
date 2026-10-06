/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('incomplete keyframe fractions cannot create or replace an anchor at zero', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('exact-keyframe.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	await dialog.getByRole('textbox', { name: 'Start (frames or num/den)', exact: true }).fill('/2');
	await dialog.getByRole('textbox', { name: 'End (frames or num/den)', exact: true }).fill('20');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Check the exact positions, values, and curve shape.');
	await expect(dialog.getByText('Add a curve to begin editing.', { exact: true })).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Start (frames or num/den)', exact: true }).fill('0/2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await dialog.getByRole('textbox', { name: 'Position (frames or num/den)', exact: true }).fill('/2');
	await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('1.5');
	await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Check the exact positions, values, and curve shape.');
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	expect(transfer.curve.anchors.map(({ value }) => value)).toEqual([1, 1.2]);
});
