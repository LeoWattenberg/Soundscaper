/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, openClipProperties } from './audio-editor-test-helpers.js';

test('raw PCM sample rate preserves a complete native scientific entry', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
	const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
	await dialog.getByLabel('Raw PCM file').setInputFiles({
		name: 'ordinary-short-tone.raw', mimeType: 'application/octet-stream', buffer: toneA.buffer.subarray(44, 236),
	});
	const rate = dialog.getByRole('spinbutton', { name: 'Sample rate', exact: true });
	await rate.focus(); await rate.press('ControlOrMeta+A'); await rate.press('Backspace');
	await rate.pressSequentially('4.8e4');
	await rate.press('Tab');
	await expect.poll(() => rate.inputValue().then(Number)).toBe(48_000);
	await dialog.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(page.getByRole('alert').filter({ hasText: 'The action failed' })).toHaveCount(0);
	const clip = editor.getByRole('group', { name: /ordinary-short-tone.wav clip/u });
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	const duration = properties.getByRole('group', { name: 'Duration', exact: true }).locator('.timecode-digit');
	await expect.poll(async () => (await duration.allTextContents()).join('')).toBe('000000002');
});
