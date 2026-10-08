/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const owner of ['fade', 'label']) test(`the native ${owner} popup releases ordinary project shortcuts`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	let count = 0;
	if (owner === 'fade') {
		await clip.getByRole('slider', { name: 'Fade in', exact: true }).press('End');
		const shape = clip.getByRole('slider', { name: 'Fade in shape', exact: true });
		await shape.press('Shift+F10');
		await expect(page.locator('.audio-editor-fade-shape-menu').getByRole('menuitemradio').first()).toBeFocused();
	} else {
		await page.keyboard.press('ControlOrMeta+b');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
		await title.fill('Section');
		await title.press('Enter');
		const label = editor.getByRole('group', { name: 'Edit labels: Section', exact: true });
		await label.press('Shift+F10');
		await expect(page.locator('.audio-editor-label-context-menu').getByRole('menuitem').first()).toBeFocused();
		count = 1;
	}
	await page.keyboard.press('ControlOrMeta+b');
	await expect(editor.locator('[data-label-id]')).toHaveCount(count + 1);
	const draft = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await expect(draft).toBeFocused();
	await draft.fill('From popup');
	await draft.press('Enter');
	await expect(editor.getByRole('group', { name: 'Edit labels: From popup', exact: true })).toBeFocused();
});
