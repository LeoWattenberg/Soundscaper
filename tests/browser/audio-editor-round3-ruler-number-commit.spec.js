import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Frequency ruler completed numbers', () => {
	registerAudioEditorHooks();
	test('Enter preserves scientific frequency drafts and accepts values below project Nyquist', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		const ruler = editor.locator('[data-track-ruler]').first();
		await ruler.click({ button: 'right' });
		const maximum = page.locator('.ruler-flyout input[type="text"]').nth(1);
		await maximum.fill('1e3');
		await maximum.press('Enter');
		await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '1000');
		await ruler.click({ button: 'right' });
		await maximum.fill('23000');
		await maximum.press('Enter');
		await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '23000');
	});
});
