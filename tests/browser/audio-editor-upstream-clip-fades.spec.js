/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('upstream clip handle interaction', () => {
	registerAudioEditorHooks();

	test('F/T/S focus named handles, cycle to the clip, and protect clips from fade Delete', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.focus();
		await clip.press('f');
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await expect(fadeIn).toBeFocused();
		const original = Number(await fadeIn.getAttribute('aria-valuenow'));
		await fadeIn.press('ArrowRight');
		await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(original);
		await fadeIn.press('f');
		const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
		await expect(fadeOut).toBeFocused();
		await fadeOut.press('f');
		await expect(clip).toBeFocused();
		await clip.press('t');
		await expect(clip.locator('.clip-display__handle--trim-left')).toBeFocused();
		await page.keyboard.press('s');
		await expect(clip.locator('.clip-display__handle--stretch-left')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(clip).toBeFocused();
		await clip.press('f');
		await fadeIn.press('Delete');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0');
		await expect(clip).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(original);
		expect(errors).toEqual([]);
	});

	test('fade menu opens the live Fades dialog, Cancel discards and Apply is one undo step', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.focus();
		await clip.press('f');
		const fadeIn = clip.getByRole('slider', { name: 'Fade in', exact: true });
		const original = await fadeIn.getAttribute('aria-valuenow');
		const open = async () => {
			await fadeIn.focus();
			await fadeIn.press('Shift+F10');
			await page.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
			return page.getByRole('dialog', { name: 'Fades', exact: true });
		};
		let dialog = await open();
		await dialog.getByRole('textbox', { name: 'Fade-in length', exact: true }).fill('0.15');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.15');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(fadeIn).toHaveAttribute('aria-valuenow', original);
		dialog = await open();
		await dialog.getByRole('textbox', { name: 'Fade-in length', exact: true }).fill('0.2');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(fadeIn).toHaveAttribute('aria-valuenow', '0.2');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', original);
	});

	test('fades remain reachable on an unselected clip and clip menu exposes both fade parents', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await clip.hover();
		await expect(clip.getByRole('slider', { name: 'Fade in', exact: true })).toBeVisible();
		await clip.click({ button: 'right', position: { x: 40, y: 50 } });
		const menu = page.locator('.audio-editor-clip-context-menu');
		const fade = menu.getByRole('menuitem', { name: /^Fade in$/u });
		await fade.hover();
		await fade.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Fades', exact: true })).toBeVisible();
	});
});
