/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

async function openKeyframes(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('exact-keyframes.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await page.keyboard.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	return dialog;
}

test('adding a keyframe curve preserves supported exact fractional values', async ({ page }) => {
	const dialog = await openKeyframes(page);
	await dialog.getByRole('spinbutton', { name: 'Start value', exact: true }).fill('1.234');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.456');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('combobox', { name: 'Anchor', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	expect(transfer.curve.anchors.map(anchor => anchor.value)).toEqual([1.234, 1.456]);
});

test('updating an anchor accepts fractional precision and retains bounded admission', async ({ page }) => {
	const dialog = await openKeyframes(page);
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	const value = dialog.getByRole('spinbutton', { name: 'Value', exact: true });
	await value.fill('1.234');
	await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true });
	await expect.poll(async () => JSON.parse(await transfer.inputValue()).curve.anchors[0].value).toBe(1.234);
	await value.fill('101');
	await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	expect(JSON.parse(await transfer.inputValue()).curve.anchors[0].value).toBe(1.234);
});
