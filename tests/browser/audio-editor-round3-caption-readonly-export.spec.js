/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

test('a caption sidecar remains exportable after another tab takes the editing lease', async ({ page, context }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	await dialog.getByRole('textbox', { name: 'Sidecar text', exact: true }).fill('1\n00:00:00,000 --> 00:00:01,000\nBonjour\n');
	await dialog.getByRole('button', { name: 'Import sidecar text', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('No interchange losses.');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	await other.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	const secondEditor = await waitForEditor(other);
	await expect(secondEditor).toHaveAttribute('data-project-id', projectId);
	await expect(dialog.getByRole('textbox', { name: 'Sidecar text', exact: true })).toBeDisabled();
	await page.bringToFront();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	await expect(dialog.getByRole('textbox', { name: 'Sidecar text', exact: true })).toBeDisabled();
	const exportButton = dialog.getByRole('button', { name: 'Export selected track', exact: true });
	await expect(exportButton).toBeEnabled();
	const downloading = page.waitForEvent('download');
	await exportButton.click();
	const download = await downloading;
	expect(await readFile(await download.path(), 'utf8')).toContain('Bonjour');
	await other.close();
});
