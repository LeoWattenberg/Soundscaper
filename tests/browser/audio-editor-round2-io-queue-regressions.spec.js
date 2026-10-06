/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, disableNativeSavePicker, importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

test('a canceled queued delivery can be retried from its own row', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const exportDialog = await openExportDialog(page, editor);
	await exportDialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Recoverable WAV');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseFileAction(page, editor, 'Delivery queue');
	const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	await queue.getByRole('button', { name: 'Pause between jobs', exact: true }).click();
	await queue.getByRole('checkbox', { name: 'Recoverable WAV', exact: true }).check();
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	const row = queue.getByRole('listitem').filter({ hasText: 'project — Recoverable WAV' });
	await expect(row).toContainText('Queued');
	await row.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(row).toContainText('Cancelled');
	await row.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(row).toContainText('Queued');
	const download = page.waitForEvent('download');
	await queue.getByRole('button', { name: 'Resume', exact: true }).click();
	await expect(row).toContainText('Delivered', { timeout: 30_000 });
	expect((await download).suggestedFilename()).toMatch(/\.wav$/u);
});
