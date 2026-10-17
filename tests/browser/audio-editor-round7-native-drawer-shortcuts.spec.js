/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test.use({ viewport: { width: 1_440, height: 1_000 } });

test('Clip properties settings retain keyboard activation, selected audio and trigger focus', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const panel = await openClipProperties(page, editor, clip, { additional: false });
	const trigger = panel.getByRole('button', { name: 'Media settings', exact: true });
	const menu = page.getByRole('menu', { name: 'Media settings', exact: true });
	const timecode = menu.getByRole('menuitemcheckbox', { name: 'Timecode fields', exact: true });
	await trigger.focus();
	await trigger.press('Enter');
	await expect(menu).toBeVisible();
	await expect(timecode).toHaveAttribute('aria-checked', 'false');
	await timecode.press('Space');
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(panel.locator('[data-clip-field="startFrame"]')).toBeVisible();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await trigger.press('Enter');
	await expect(timecode).toHaveAttribute('aria-checked', 'true');
	await menu.press('Escape');
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.press('Space');
	await timecode.press('Enter');
	await expect(menu).toBeHidden();
	await expect(panel.getByRole('textbox', { name: 'Start', exact: true })).toBeVisible();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	expect(errors).toEqual([]);
});
