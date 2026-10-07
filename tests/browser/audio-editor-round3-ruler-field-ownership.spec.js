import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Frequency ruler field editing', () => {
	registerAudioEditorHooks();
	test('an edited frequency field owns its stepping and caret arrows', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		await editor.locator('[data-track-ruler]').first().click({ button: 'right' });
		const flyout = page.locator('.ruler-flyout');
		const minimum = flyout.locator('input[type="text"]').first();
		await minimum.click();
		await minimum.press('ArrowUp');
		await expect(minimum).toHaveValue('10');
		await expect(minimum).toBeFocused();
		await minimum.press('ArrowLeft');
		await expect(minimum).toBeFocused();
	});
});
