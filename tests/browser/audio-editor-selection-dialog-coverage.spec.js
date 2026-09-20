/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	readFile,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clipByName,
	closeDialog,
	collectClientErrors,
	commitInput,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('selection effect dialog coverage', () => {
	registerAudioEditorHooks();

	test('previews, applies, and round-trips a custom effect preset', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
		const dialog = page.locator('[data-selection-effects-dialog]');
		await expect(dialog).toBeVisible();

		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stopPreview = dialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stopPreview).toBeVisible({ timeout: 20_000 });
		await stopPreview.click();

		const roomSize = dialog.locator('[data-effect-param="roomSize"] input');
		await commitInput(roomSize, '73');
		await saveAsPreset(page, dialog, 'Coverage room');
		const preset = dialog.getByRole('button', { name: 'Preset', exact: true });
		await expect(preset).toContainText('Coverage room');

		await commitInput(roomSize, '61');
		await expect(preset).toContainText('*');
		await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
		await expect(roomSize).toHaveValue('73');

		await commitInput(roomSize, '68');
		await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Save preset', exact: true }).click();
		await expect(preset).not.toContainText('*');

		const exportPromise = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click();
		const exported = await exportPromise;
		const exportPath = await exported.path();
		expect(exportPath).not.toBeNull();
		const encoded = await readFile(exportPath);
		expect(JSON.parse(encoded.toString()).presets[0].name).toBe('Coverage room');

		await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
		await expect(preset).toContainText('Default preset');
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		const chooserPromise = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
		const chooser = await chooserPromise;
		await chooser.setFiles({ name: 'coverage-room.json', mimeType: 'application/json', buffer: encoded });
		await preset.click();
		const imported = page.getByRole('option', { name: /Coverage room/u });
		await expect(imported).toBeVisible();
		await imported.click();
		await expect(roomSize).toHaveValue('68');

		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		expect(errors).toEqual([]);
	});

	test('selects an eligible sidechain control track for Auto Duck', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await clipByName(editor, toneA.name).click({ position: { x: 30, y: 12 } });
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
		const dialog = page.locator('[data-selection-effects-dialog]');
		const controlTrack = dialog.getByRole('group', { name: 'Control track', exact: true });
		await expect(controlTrack).toBeVisible();
		await chooseDropdown(page, controlTrack, 'browser-tone-b');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible({
			timeout: 20_000,
		});
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});

async function saveAsPreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(prompt).toBeHidden();
}
