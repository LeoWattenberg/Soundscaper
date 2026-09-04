/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	closeDialog,
	collectClientErrors,
	commitInput,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { toneA } from './audio-editor-test-fixtures.js';

test.describe('Soundscaper native production workflows', () => {
	registerAudioEditorHooks();

	test('keeps mastering standalone and metering only in EBU R 128', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');
		await expect(page.getByRole('dialog', { name: 'Production audio', exact: true })).toHaveCount(0);

		const tracks = await openNestedCommandMenu(page, editor, 'Tracks', []);
		await expect(getMenuItem(tracks, 'Automation')).toHaveCount(0);
		await page.keyboard.press('Escape');
		const viewPanels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		await expect(getMenuItem(viewPanels, 'Routing graph…')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		const analyze = await openNestedCommandMenu(page, editor, 'Analyze', []);
		await expect(getMenuItem(analyze, 'Production meters…')).toHaveCount(0);
		await page.keyboard.press('Escape');
		const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
		await expect(getMenuItem(tools, 'Reviewed effects…')).toHaveCount(0);
		await page.keyboard.press('Escape');

		const toolsTrigger = editor.getByRole('menubar', { name: 'Application menu', exact: true })
			.getByRole('menuitem', { name: 'Tools', exact: true });
		await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences…');
		const mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
		await expect(mastering).toBeVisible();
		await expect(mastering.getByRole('tablist')).toHaveCount(0);
		await expect(mastering.locator('[data-soundscaper-mastering-sequence-editor]')).toBeVisible();
		await mastering.getByRole('button', { name: 'New sequence', exact: true }).click();
		await expect(mastering.getByRole('status')).toHaveText('Mastering sequence updated.');
		await assertAccessibleBasics(mastering);
		await assertNoSeriousAxeViolations(page, '[data-soundscaper-mastering-sequence-dialog]');
		await page.emulateMedia({ forcedColors: 'active' });
		await expect(mastering).toHaveCSS('border-top-style', 'solid');
		await page.emulateMedia({ forcedColors: 'none' });
		await closeDialog(mastering);
		await expect(toolsTrigger).toBeFocused();

		await chooseCommandAction(page, editor, 'Analyze', 'EBU R 128');
		await expect(editor.locator('[data-workspace-panel="ebu-r128"]')).toBeVisible();
		await expect(page.getByRole('dialog', { name: 'Production audio', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('applies Reviewed Utility Gain through the canonical Effect dialog', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Utility Gain (Reviewed)']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Utility Gain (Reviewed)');
		await commitInput(dialog.locator('[data-effect-param="gain"] input'), '2');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('loads and runs Restoration as an ordinary macro after profile capture', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Tools', 'Macro manager');

		let manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
		await manager.getByRole('button', { name: 'Restoration', exact: true }).click();
		await expect(manager.locator('.effect-slot__name-text')).toHaveText([
			'Click Removal', 'Noise Reduction', 'Filter Curve EQ',
		]);
		const runMacro = manager.getByRole('button', { name: 'Run macro', exact: true });
		await expect(runMacro).toBeDisabled();
		await expect(manager.locator('[data-macro-noise-profile-required]')).toBeVisible();

		await manager.getByRole('group', { name: 'Noise Reduction', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		const noiseReduction = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		await noiseReduction.getByRole('button', { name: 'Get noise profile', exact: true }).click();
		await expect(noiseReduction.getByRole('button', { name: 'Replace noise profile', exact: true }))
			.toBeVisible({ timeout: 20_000 });
		await closeDialog(noiseReduction);

		manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
		await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
		await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
		await expect(manager.getByRole('status')).toHaveText('Macro applied.', { timeout: 30_000 });
		await closeDialog(manager);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		expect(errors).toEqual([]);
	});
});
