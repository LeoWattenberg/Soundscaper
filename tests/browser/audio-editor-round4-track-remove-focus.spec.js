/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('closing a focused track hands keyboard navigation to a surviving track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	await second.locator('.clip-header').click();
	await expect(second).toBeFocused();
	await page.keyboard.press('Shift+c');
	await expect(second).toHaveCount(0);
	const survivor = first.locator('xpath=ancestor::div[@data-track-row]');
	await expect.poll(() => survivor.evaluate(row => row.contains(document.activeElement))).toBe(true);
	await page.keyboard.press('Shift+c');
	await expect(first).toHaveCount(0);
});
