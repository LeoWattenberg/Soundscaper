/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown,
	closeDialog, closeWorkspacePanel, disableNativeSavePicker, importFiles,
	openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('a pristine ADM export preserves existing tags without adding a default replacement title', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	let dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await importFiles(editor, [{ name: 'pristine-programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) }]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
	expect(chunkBodies(await readDownloadBytes(page, dialog.locator('[data-export-download]')))).toEqual(chunkBodies(bytes));
});

function chunkBodies(bytes) {
	expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('BW64');
	expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks = [];
	let dataSize = 0;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
		const declaredSize = view.getUint32(offset + 4, true);
		const size = id === 'data' && declaredSize === 0xffffffff ? dataSize : declaredSize;
		expect(size).toBeGreaterThan(0);
		expect(offset + 8 + size).toBeLessThanOrEqual(bytes.byteLength);
		if (id === 'ds64') dataSize = Number(view.getBigUint64(offset + 16, true));
		chunks.push({ id, bytes: bytes.subarray(offset + 8, offset + 8 + size) });
		offset += 8 + size + (size % 2);
	}
	expect(offset).toBe(bytes.byteLength);
	return chunks.sort((first, second) => first.id.localeCompare(second.id));
}
