/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const [key, decorated] of [['b', '**Take one**'], ['i', '*Take one*']]) {
	test(`Recording notes leaves composed Ctrl+${key.toUpperCase()} to the input method`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
		const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
		await notes.fill('Take one');
		await notes.press('ControlOrMeta+A');
		await notes.press(`ControlOrMeta+${key}`);
		await expect(notes).toHaveValue(decorated);
		await notes.fill('とう');
		await notes.press('ControlOrMeta+A');
		const prevented = await notes.evaluate((field, composingKey) => {
			const event = new KeyboardEvent('keydown', {
				key: composingKey, ctrlKey: true, bubbles: true, cancelable: true, isComposing: true,
			});
			field.dispatchEvent(event);
			return event.defaultPrevented;
		}, key);
		await expect(notes).toHaveValue('とう');
		expect(prevented).toBe(false);
		await notes.fill('東京の録音');
		await notes.press('ControlOrMeta+A');
		await notes.press(`ControlOrMeta+${key}`);
		await expect(notes).toHaveValue(key === 'b' ? '**東京の録音**' : '*東京の録音*');
	});
}
