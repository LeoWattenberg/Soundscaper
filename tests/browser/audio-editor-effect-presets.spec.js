import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeDialog,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('effect presets Audacity ships', () => {
	registerAudioEditorHooks();

	test('offers a shipped reverb preset in the effect dialog and applies its settings', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		await page.keyboard.press('Control+k');
		await editor.locator('[data-editor-search-input]').fill('Reverb');
		const reverb = editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]');
		await expect(reverb).toBeVisible();
		await reverb.click();

		const dialog = page.locator('[data-selection-effects-dialog]');
		await expect(dialog).toBeVisible();
		const presets = dialog.getByRole('button', { name: 'Preset', exact: true });
		await expect(presets).toContainText('No preset');
		await presets.click();

		// The list carries Audacity's own presets, and none of them is marked as
		// a preset this project saved.
		const cathedral = page.getByRole('option', { name: 'Cathedral', exact: true });
		await expect(page.getByRole('option', { name: 'Vocal I', exact: true })).toBeVisible();
		await expect(cathedral).toBeVisible();
		await cathedral.click();

		await expect(presets).toContainText('Cathedral');
		await expect(presets).not.toContainText('custom');
		await expect(dialog.locator('[data-effect-param="roomSize"] input')).toHaveValue('90');
		await expect(dialog.locator('[data-effect-param="reverberance"] input')).toHaveValue('90');
		await expect(dialog.locator('[data-effect-param="toneHigh"] input')).toHaveValue('0');
		await expect(dialog.locator('[data-effect-param="dryGainDb"] input')).toHaveValue('-20');

		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
