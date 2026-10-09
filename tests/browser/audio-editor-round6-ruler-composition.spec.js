/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

for (const key of ['Escape', 'Enter']) test(`the frequency ruler retains its unfinished native ${key} draft`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const ruler = editor.locator('[data-track-ruler]').first();
	await ruler.click({ button: 'right' });
	const flyout = page.locator('.ruler-flyout');
	const maximum = flyout.locator('input[type="text"]').nth(1);
	await maximum.fill('1e3');
	await maximum.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '1000');
	await maximum.fill('2e3');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '1000');
	await maximum.evaluate((field, code) => {
		field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent('keydown', { key: code, isComposing: true, bubbles: true, cancelable: true }));
	}, key);
	await expect(flyout).toBeVisible();
	await expect(maximum).toHaveValue('2e3');
	await expect(maximum).toBeFocused();
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '1000');
	await maximum.evaluate(field => field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
	await maximum.fill('3e3');
	await maximum.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '3000');
	await maximum.press('Escape');
	await expect(flyout).toBeHidden();
	await expect(ruler).toBeFocused();
});
