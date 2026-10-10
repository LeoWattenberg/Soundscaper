/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction,
	closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const layout of ['stereo', 'mono']) test(`own DAWproject export and Open retain the ${layout} master delivery width`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await metadata.locator('select[name="adm-bed-layout"]').selectOption(layout);
	await closeWorkspacePanel(editor, 'metadata');
	const expectedChannels = layout === 'mono' ? 1 : 2;
	expect(await deliveredWidth(page, editor)).toBe(expectedChannels);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const projectXml = new TextDecoder().decode(unzipSync(bytes)['project.xml']);
	expect(projectXml).toMatch(new RegExp(`<Channel[^>]*audioChannels="${expectedChannels}"[^>]*role="master"`, 'u'));
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(await deliveredWidth(page, editor)).toBe(expectedChannels);
});

async function deliveredWidth(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeChecked();
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let channels = null;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'fmt ') { channels = view.getUint16(offset + 10, true); break; }
		offset += 8 + size + size % 2;
	}
	expect(channels).not.toBeNull();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return channels;
}
