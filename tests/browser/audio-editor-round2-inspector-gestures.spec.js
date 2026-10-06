/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('one Undo restores a complete Clip properties fade-shape drag', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await properties.getByText('Fading', { exact: true }).click();
	const shape = properties.getByRole('slider', { name: 'Fade in shape', exact: true });
	const original = await shape.inputValue();
	const bounds = await shape.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(shape).not.toHaveValue(original);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(shape).toHaveValue(original);
});

test('Escape cancels a Clip properties fade-shape drag before mouse release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Fading', { exact: true }).click();
	const shape = properties.getByRole('slider', { name: 'Fade in shape', exact: true });
	const original = await shape.inputValue();
	const bounds = await shape.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2, { steps: 12 });
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(shape).toHaveValue(original);
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
});
