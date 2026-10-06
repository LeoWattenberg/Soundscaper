/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels a timeline label move before its mouse release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('slider', { name: 'Playhead' }).focus();
	await page.keyboard.press('Control+b');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Intro');
	await title.press('Enter');
	const label = editor.getByRole('group', { name: 'Edit labels: Intro', exact: true });
	const position = () => label.evaluate(element => element.style.left);
	const original = await position();
	const box = await label.locator('.label-marker__label-box').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
	await expect.poll(position).not.toBe(original);
	await page.keyboard.press('Escape');
	await expect.poll(position).toBe(original);
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
	await expect.poll(position).toBe(original);
	await page.mouse.up();
	await expect.poll(position).toBe(original);
});
