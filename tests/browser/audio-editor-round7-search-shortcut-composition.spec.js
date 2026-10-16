/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

test('Search releases the active recording-notes composition and opens after native completion', async ({ page }) => {
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
	const search = editor.locator('[data-editor-search]');
	const input = editor.locator('[data-editor-search-input]');
	await notes.fill('Take one');
	await notes.press('ControlOrMeta+k');
	await expect(search).toHaveAttribute('data-editor-search-open', 'true');
	await expect(input).toBeFocused();
	await input.press('Escape');
	await expect(notes).toBeFocused();
	await notes.fill('とう');
	for (const [isComposing, keyCode] of [[true, 75], [false, 229]]) {
		const prevented = await notes.evaluate((field, nativeState) => {
			const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true,
				bubbles: true, cancelable: true, isComposing: nativeState.isComposing,
				keyCode: nativeState.keyCode });
			field.dispatchEvent(event);
			return event.defaultPrevented;
		}, { isComposing, keyCode });
		expect(prevented).toBe(false);
		await expect(search).toHaveAttribute('data-editor-search-open', 'false');
		await expect(notes).toBeFocused();
		await expect(notes).toHaveValue('とう');
	}
	await notes.fill('東京の録音');
	await notes.press('ControlOrMeta+k');
	await expect(search).toHaveAttribute('data-editor-search-open', 'true');
	await expect(input).toBeFocused();
	await input.fill('select-all');
	await expect(input).toHaveValue('select-all');
	await input.press('Escape');
	await expect(notes).toBeFocused();
	await expect(notes).toHaveValue('東京の録音');
	expect(clientErrors).toEqual([]);
});
