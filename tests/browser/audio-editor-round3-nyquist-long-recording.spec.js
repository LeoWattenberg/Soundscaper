/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist refuses an overlong selection without silently shortening the recording', async ({ page }) => {
	test.setTimeout(120_000);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'interview.wav', duration: 301, channelCount: 1 });
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('*track*');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	const errorToast = editor.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
	await expect(errorToast).toContainText('Nyquist audio exceeds', { timeout: 60_000 });
	await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 60_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.locator('[data-clip-field="durationFrame"] .timecode__display')).toHaveText('00h05m01.000s');
	await closeClipProperties(properties);
});
