/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('selecting an existing visual mask seeds its authored width', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const solid = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await solid.focus();
	await solid.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte']);
	const authoring = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
	await authoring.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0.5');
	await authoring.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
	await expect(authoring.getByRole('status')).toHaveText('Selected authored state applied.');
	const maskId = await authoring.getByRole('combobox', { name: 'Attached mask', exact: true }).inputValue();
	await authoring.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await solid.last().focus();
	await solid.last().press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	const inspector = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await inspector.getByRole('combobox', { name: 'Mask / matte', exact: true }).selectOption(maskId);
	await expect(inspector.getByRole('slider', { name: 'Mask width', exact: true })).toHaveValue('0.5');
});

test('reopening keyframes seeds new curve values from the selected target', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('keyframe-target.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	const [target] = await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	await expect(dialog.getByRole('combobox', { name: 'Target', exact: true })).toHaveValue(target);
	await expect(dialog.getByRole('spinbutton', { name: 'Start value', exact: true })).toHaveValue('1');
	await expect(dialog.getByRole('spinbutton', { name: 'End value', exact: true })).toHaveValue('1');
});
