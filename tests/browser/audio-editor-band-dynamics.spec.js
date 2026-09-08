/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, readFile } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog,
	collectClientErrors, effectSourceMetadata, importFiles, openEffectsForTrack, registerAudioEditorHooks, waitForEditor,
	chooseDropdown, closeEffectsPanel, disableNativeSavePicker, openExportDialog,
} from './audio-editor-test-helpers.js';

test.describe('de-esser and multiband compressor', () => {
	registerAudioEditorHooks();
	for (const effect of [
		{ name: 'De-esser', category: 'Noise removal and repair', parameter: 'Maximum reduction', value: '12' },
		{ name: 'Multiband compressor', category: 'Volume and compression', parameter: 'High threshold', value: '-36' },
	]) {
		test(`${effect.name} opens from the menu, applies and undoes`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [monoTone]);
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Effect', [effect.category, effect.name]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await expect(dialog).toBeVisible();
			const control = dialog.getByRole('spinbutton', { name: effect.parameter, exact: true });
			await control.fill(effect.value);
			await control.press('Tab');
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect.poll(async () => (await effectSourceMetadata(page)).some(source =>
				String(source.name).toLowerCase().includes(effect.name.toLowerCase()))).toBe(true);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			expect(errors).toEqual([]);
		});

		test(`${effect.name} loads its worklet and retains rack settings after reload`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [monoTone]);
			const panel = await openEffectsForTrack(editor, 1);
			await addRackEffect(page, panel, 'track', effect.name);
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			await expect(dialog).toBeVisible();
			const control = dialog.getByRole('spinbutton', { name: effect.parameter, exact: true });
			await control.fill(effect.value);
			await control.press('Tab');
			await expect(control).toHaveValue(effect.value);
			await closeDialog(dialog);
			await editor.getByRole('button', { name: 'Play', exact: true }).click();
			await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await editor.getByRole('button', { name: 'Stop', exact: true }).click();
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			const restored = await waitForEditor(page);
			const restoredPanel = await openEffectsForTrack(restored, 1);
			await restoredPanel.getByRole('group', { name: effect.name, exact: true })
				.getByRole('button', { name: 'Select effect', exact: true }).click();
			await expect(page.getByRole('dialog', { name: effect.name, exact: true })
				.getByRole('spinbutton', { name: effect.parameter, exact: true })).toHaveValue(effect.value);
			expect(errors).toEqual([]);
		});

		test(`${effect.name} renders through the offline export worklet`, async ({ page }) => {
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [monoTone]);
			const panel = await openEffectsForTrack(editor, 1);
			await addRackEffect(page, panel, 'track', effect.name);
			await closeDialog(page.getByRole('dialog', { name: effect.name, exact: true }));
			await closeEffectsPanel(panel);
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			await expect(link).toBeVisible({ timeout: 20000 });
			const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
			const bytes = await readFile(await download.path());
			let offset = 12;
			while (offset + 8 < bytes.length && bytes.toString('ascii', offset, offset + 4) !== 'data') {
				const size = bytes.readUInt32LE(offset + 4);
				offset += 8 + size + (size & 1);
			}
			expect(bytes.toString('ascii', offset, offset + 4)).toBe('data');
			expect(bytes.subarray(offset + 8).some(value => value !== 0)).toBe(true);
			expect(errors).toEqual([]);
		});
	}
});
