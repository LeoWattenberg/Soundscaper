/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Join labeled audio joins intersecting clip runs once across separate labels', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name);
	const box = await original.locator('.clip-display').boundingBox();
	expect(box).not.toBeNull();
	const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
	await splitTool.click();
	await clickClipInterior(page, original, 0.25);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await clickClipInterior(page, clipByName(editor, toneA.name).last(), 2 / 3);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await splitTool.click();
	for (const [start, end] of [[0.125, 0.375], [0.625, 0.875]]) {
		const ruler = await editor.locator('[data-ruler]').boundingBox();
		await page.mouse.move(box.x + box.width * start, ruler.y + 26);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * end, ruler.y + 26, { steps: 4 });
		await page.mouse.up();
		await page.keyboard.press('Control+b');
		await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	}
	await expect(editor.locator('[data-label-track] .audio-editor-label-marker')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Join']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
