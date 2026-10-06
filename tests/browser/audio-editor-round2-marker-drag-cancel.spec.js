/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels a timeline marker move before pointer release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	await chooseCommandAction(page, editor, 'View', 'Markers');
	const marker = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option').first();
	const position = () => marker.evaluate(element => element.style.left);
	const original = await position();
	const box = await marker.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
	await expect.poll(position).not.toBe(original);
	await page.keyboard.press('Escape');
	await expect.poll(position).toBe(original);
	await page.mouse.up();
	await expect.poll(position).toBe(original);
});
