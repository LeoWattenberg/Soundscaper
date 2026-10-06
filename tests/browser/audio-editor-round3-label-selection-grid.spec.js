/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

test('selecting an authored label retains its exact region with the time grid enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = await clipByName(editor, toneA.name).locator('.clip-display').boundingBox();
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	await page.mouse.move(clip.x + clip.width / 4, ruler.y + 26);
	await page.mouse.down();
	await page.mouse.move(clip.x + clip.width / 2, ruler.y + 26, { steps: 4 });
	await page.mouse.up();
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Exact region');
	await title.press('Enter');
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	await expect(editor.getByRole('checkbox', { name: 'Snap', exact: true })).toHaveAttribute('aria-checked', 'true');
	await editor.getByRole('group', { name: 'Edit labels: Exact region', exact: true }).click({ position: { x: 12, y: 8 } });
	await expect(editor.getByRole('group', { name: 'Selection start', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.200s');
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.400s');
});
