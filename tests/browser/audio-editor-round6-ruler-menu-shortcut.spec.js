/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const owner of ['ruler', 'fade', 'label']) test(`the ${owner} releases a configured modified context-menu chord`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Shift+F10');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	let trigger = editor.locator('[data-ruler][role="region"]');
	let menu = page.locator('.timeline-ruler-context-menu');
	let count = 0;
	if (owner !== 'ruler') {
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.locator('.clip-header').click();
		if (owner === 'fade') {
			await clip.getByRole('slider', { name: 'Fade in', exact: true }).press('End');
			trigger = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
			menu = page.locator('.audio-editor-fade-shape-menu');
		} else {
			await page.keyboard.press('ControlOrMeta+b');
			const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
			await title.fill('Section');
			await title.press('Enter');
			trigger = editor.getByRole('group', { name: 'Edit labels: Section', exact: true });
			menu = page.locator('.audio-editor-label-context-menu');
			count = 1;
		}
	}
	await trigger.focus();
	await page.keyboard.press('Shift+F10');
	await expect(menu).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await trigger.focus();
	await page.keyboard.press('Control+Alt+Shift+F10');
	await expect(editor.locator('[data-label-track]')).toHaveCount(count + 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(count);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(count + 1);
});
