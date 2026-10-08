/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const tab of ['General', 'BEXT', 'ADM']) test(`${tab} metadata releases native composition before publishing its completed text`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-metadata-editor]');
	await metadata.getByRole('tab', { name: tab, exact: true }).click();
	if (tab === 'ADM') await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	const input = metadata.locator(`input[name="${tab === 'General' ? 'title' : tab === 'BEXT' ? 'originator' : 'adm-programme-name'}"]`);
	const before = await input.inputValue();
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	await input.fill('東京の録音');
	await input.press('Enter');
	await expect(input).toHaveValue('東京の録音');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(input).toHaveValue(before);
});
