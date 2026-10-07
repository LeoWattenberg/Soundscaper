/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const key of ['Enter', 'Escape']) {
	test(`inline clip rename ${key} returns keyboard focus to its clip`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.locator('.clip-header').click();
		await clip.press('F2');
		const input = clip.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(input).toBeFocused();
		await input.fill('Renamed recording');
		await input.press(key);
		const result = clipByName(editor, key === 'Enter' ? 'Renamed recording' : toneA.name);
		await expect(result).toBeVisible();
		await expect(input).toHaveCount(0);
		await expect(result).toBeFocused();
		const before = await result.boundingBox();
		await page.keyboard.press('Control+ArrowRight');
		await expect.poll(async () => (await result.boundingBox())?.x).toBeGreaterThan(before.x);
	});
}
