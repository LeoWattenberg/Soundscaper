/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('clearing a loop discards its old boundaries before looping a new selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = await clipByName(editor, toneA.name).locator('.clip-display').boundingBox();
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	const select = async (start, end) => {
		await page.mouse.move(clip.x + clip.width * start, ruler.y + 26);
		await page.mouse.down();
		await page.mouse.move(clip.x + clip.width * end, ruler.y + 26, { steps: 4 });
		await page.mouse.up();
	};
	const start = editor.getByRole('group', { name: 'Selection start', exact: true }).locator('.timecode__display');
	const end = editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display');
	await select(0.25, 0.5);
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Clear loop region']);
	const toggle = editor.getByRole('button', { name: 'Loop selection', exact: true });
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await select(0.5, 0.75);
	const selectedStart = await start.textContent();
	const selectedEnd = await end.textContent();
	await toggle.click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set selection to loop']);
	await expect(start).toHaveText(selectedStart);
	await expect(end).toHaveText(selectedEnd);
});
