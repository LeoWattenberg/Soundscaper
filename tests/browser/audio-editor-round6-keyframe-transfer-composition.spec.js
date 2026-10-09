/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('curve transfer shortcuts preserve an unfinished native text composition', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('composition-curve.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	const transfer = dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true });
	await transfer.focus();
	await transfer.press('Control+Shift+C');
	expect(JSON.parse(await transfer.inputValue()).curve.anchors).toHaveLength(2);
	await transfer.fill('とう');
	const prevented = await transfer.evaluate(element => {
		const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true,
			isComposing: true, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(transfer).toHaveValue('とう');
	await expect(transfer).toBeFocused();
	await transfer.press('Control+Shift+C');
	expect(JSON.parse(await transfer.inputValue()).curve.anchors).toHaveLength(2);
});
