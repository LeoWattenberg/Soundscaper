/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('ADM numeric metadata retains native composition before its completed angle', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
	await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await panel.getByRole('button', { name: 'Add object', exact: true }).click();
	const angle = panel.getByLabel('Azimuth', { exact: true });
	await angle.fill('10');
	await angle.press('Enter');
	await expect(angle).toHaveValue('10');
	await angle.fill('20');
	const prevented = await angle.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(angle).toHaveValue('20');
	await expect(angle).toBeFocused();
	await angle.fill('30');
	await angle.press('Enter');
	await expect(angle).toHaveValue('30');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(angle).toHaveValue('10');
});
