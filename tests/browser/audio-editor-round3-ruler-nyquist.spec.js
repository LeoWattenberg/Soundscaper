import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Frequency ruler sample-rate bounds', () => {
	registerAudioEditorHooks();
	test('the ruler accepts a maximum below the actual 48 kHz project Nyquist', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		const ruler = editor.locator('[data-track-ruler]').first();
		await ruler.click({ button: 'right' });
		const maximum = page.locator('.ruler-flyout input[type="text"]').nth(1);
		await maximum.fill('23000');
		await maximum.press('Enter');
		await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '23000');
	});
});
