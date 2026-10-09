/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('an ordinary imported macro command keeps its numeric native composition', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		palette.getByRole('button', { name: 'Import macro', exact: true }).click(),
	]);
	await chooser.setFiles({
		name: 'ordinary-time.txt', mimeType: 'text/plain',
		buffer: Buffer.from('SelectTime: Start="0.1" End="0.5"\nInvert:\n'),
	});
	const step = palette.locator('.effect-slot').filter({ hasText: 'SelectTime' });
	await step.getByRole('button', { name: 'Select effect', exact: true }).click();
	const parameters = page.getByRole('dialog', { name: 'SelectTime', exact: true });
	await expect(parameters).toBeVisible();
	const start = parameters.getByRole('spinbutton', { name: 'Start', exact: true });
	await start.fill('0.2');
	await start.press('Enter');
	await expect(start).toHaveValue('0.2');
	await start.fill('0.3');
	const prevented = await start.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(start).toHaveValue('0.3');
	await expect(start).toBeFocused();
	await start.fill('0.4');
	await start.press('Enter');
	await expect(start).toHaveValue('0.4');
	await parameters.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(step).toContainText('start 0.4');
	await palette.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	await expect(step).toContainText('start 0.4');
});
