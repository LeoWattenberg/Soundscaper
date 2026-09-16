/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog,
	collectClientErrors, commitInput, importFiles, registerAudioEditorHooks,
	getMenuItem, chooseDropdown,
} from './audio-editor-test-helpers.js';

test.describe('Audacity selection default preset', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('resetting the default compressor preset persists through a controller snapshot and reopening', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const openCompressor = async () => {
			await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Compressor']);
			return page.getByRole('dialog', { name: 'Apply effect', exact: true });
		};
		let dialog = await openCompressor();
		const threshold = dialog.getByRole('group', { name: 'Threshold (dB)', exact: true }).getByRole('spinbutton');
		await expect(threshold).toHaveValue('-12');
		await commitInput(threshold, '-24');
		await expect(threshold).toHaveValue('-24');
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('Default preset*');
		await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
		await expect(threshold).toHaveValue('-12');
		await closeDialog(dialog);
		// Reopening reads the controller's stored selection parameters, so a
		// transient local reset cannot satisfy this assertion.
		dialog = await openCompressor();
		await expect(dialog.getByRole('group', { name: 'Threshold (dB)', exact: true }).getByRole('spinbutton')).toHaveValue('-12');
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('Default preset');
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).not.toContainText('*');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('desktop menu effect changes reset the previous dialog’s local control state', async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.scapeDesktop = { v1: {
				version: 1,
				getEnvironment: () => Promise.resolve({ platform: 'win32' }),
			} };
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Bass and Treble']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const link = dialog.getByRole('checkbox', { name: 'Auto-adjust volume to preserve loudness', exact: true });
		await expect(link).not.toBeChecked();
		await link.check();
		const effectTrigger = editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Effect', exact: true });
		const accessKey = await effectTrigger.getAttribute('aria-keyshortcuts');
		expect(accessKey).toMatch(/^Alt\+/u);
		const changeEffect = async (category, effect) => {
			await page.keyboard.press(accessKey);
			const menu = page.getByRole('menu', { name: 'Effect', exact: true });
			await expect(menu).toBeVisible();
			await expect(menu.getByRole('menuitem', { disabled: false }).first()).toBeFocused();
			const parent = getMenuItem(menu, category);
			await parent.press('ArrowRight');
			const submenu = parent.getByRole('menu');
			await expect(submenu).toBeVisible();
			// Opening a submenu schedules focus on its first item. Wait for that
			// before choosing another item so delayed focus cannot redirect Enter.
			await expect(submenu.getByRole('menuitem').first()).toBeFocused();
			const target = getMenuItem(submenu, effect);
			await target.focus();
			await expect(target).toBeFocused();
			await target.press('Enter');
			await expect(menu).toBeHidden();
		};
		await changeEffect('Delay and reverb', 'Reverb');
		await expect(dialog.locator('[data-audacity-effect-layout="audacity-reverb"]')).toBeVisible();
		await changeEffect('EQ and filters', 'Bass and Treble');
		await expect(dialog.locator('[data-audacity-effect-layout="audacity-bass-treble"]')).toBeVisible();
		await expect(link).not.toBeChecked();
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Delay default reset restores its existing selection-only processing choices', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Delay']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const pitch = dialog.getByRole('group', { name: 'Pitch change effect', exact: true });
		const duration = dialog.getByRole('group', { name: 'Echo duration', exact: true });
		await chooseDropdown(page, pitch, 'Pitch/Tempo (change speed)');
		await chooseDropdown(page, duration, 'Include complete echoes');
		await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
		await expect(pitch.getByRole('button')).toContainText('Pitch shift (keep tempo)');
		await expect(duration.getByRole('button')).toContainText('Keep selected duration');
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).not.toContainText('*');
		await closeDialog(dialog);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Delay']);
		await expect(pitch.getByRole('button')).toContainText('Pitch shift (keep tempo)');
		await expect(duration.getByRole('button')).toContainText('Keep selected duration');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
