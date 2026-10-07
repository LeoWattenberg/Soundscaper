/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Ctrl+B from Looped clip length adds a label without extending the recording', async ({ page }) => {
	const recording = createWavFixture({ name: 'loop-shortcut.wav' });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	await expect(loop).toBeVisible();
	await loop.focus();
	const duration = await loop.getAttribute('aria-valuenow');
	await page.keyboard.press('ControlOrMeta+b');
	await expect(editor.locator('[data-label-id]')).toHaveCount(1);
	await expect(loop).toHaveAttribute('aria-valuenow', duration);
});
