/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, clickClipInterior,
	openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('Previous clip starts from the clip selected through its header', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, monoTone.name), 0.5);
	await split.click();
	const clips = editor.locator('[data-clip-id]');
	await expect(clips).toHaveCount(2);
	await clips.nth(1).locator('.clip-header').click();
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	const menu = await openNestedCommandMenu(page, editor, 'Select', ['Audio clips']);
	await menu.getByRole('menuitem', { name: /^Previous clip(?! boundary)(?:\s|$)/u }).press('Enter');
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'false');
});
