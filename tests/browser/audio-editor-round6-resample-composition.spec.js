/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('the clip resample field keeps its native composition until the completed Enter', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await properties.getByText('Media settings', { exact: true }).click();
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
	const rate = dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u });
	await rate.fill('24000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(properties.locator('[data-clip-source-fact="sampleRate"]')).toContainText('24000');
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	await rate.fill('32000');
	const prevented = await rate.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(dialog).toBeVisible();
	await expect(rate).toBeFocused();
	await expect(properties.locator('[data-clip-source-fact="sampleRate"]')).toContainText('24000');
	await rate.fill('48000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(properties.locator('[data-clip-source-fact="sampleRate"]')).toContainText('48000');
	await properties.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await restored.getByText('Media settings', { exact: true }).click();
	await expect(restored.locator('[data-clip-source-fact="sampleRate"]')).toContainText('24000');
});
