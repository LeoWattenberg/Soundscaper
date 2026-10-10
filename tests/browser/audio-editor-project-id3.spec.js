/* SPDX-License-Identifier: AGPL-3.0-only */

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, closeWorkspacePanel, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');

test('project ID3 fields, artwork and undo persist before exporting tagged browser files', async ({ page }) => {
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	let panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	await panel.getByRole('textbox', { name: 'Title', exact: true }).fill('東京 — Episode');
	await panel.getByRole('textbox', { name: 'Title', exact: true }).press('Tab');
	await panel.getByRole('textbox', { name: 'Artist', exact: true }).fill('Élodie');
	await panel.getByRole('textbox', { name: 'Artist', exact: true }).press('Tab');
	const genre = panel.getByRole('textbox', { name: 'Genre', exact: true });
	await genre.fill('Ambient');
	await genre.press('Tab');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(genre).toHaveValue('');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(genre).toHaveValue('Ambient');
	await panel.getByRole('textbox', { name: 'Composer', exact: true }).fill('Renée');
	await panel.getByRole('textbox', { name: 'Composer', exact: true }).press('Tab');
	await panel.getByLabel('Add artwork', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
	await expect(panel.getByRole('img', { name: 'cover.png', exact: true })).toHaveCount(1);
	await closeWorkspacePanel(editor, 'metadata');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: 'Genre', exact: true })).toHaveValue('Ambient');
	await expect(panel.getByRole('textbox', { name: 'Composer', exact: true })).toHaveValue('Renée');
	await expect(panel.getByRole('img', { name: 'cover.png', exact: true })).toHaveCount(1);
	await closeWorkspacePanel(editor, 'metadata');
	for (const format of ['WAV', 'AIFF', 'MP3', 'FLAC', 'Ogg Vorbis', 'Opus', 'WavPack', 'MP2']) {
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), format);
		await expect(dialog.getByRole('button', { name: 'Metadata', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const extension = { WAV: 'wav', AIFF: 'aiff', MP3: 'mp3', FLAC: 'flac', 'Ogg Vorbis': 'ogg', Opus: 'opus', WavPack: 'wv', MP2: 'mp2' }[format];
		await expect(link).toHaveAttribute('download', new RegExp(`\\.${extension}$`), { timeout: 20_000 });
		const bytes = await readDownloadBytes(page, link);
		if (format === 'WavPack' || format === 'MP2' || format === 'AIFF') {
			expect(Buffer.from(bytes).includes(Buffer.from('Ambient'))).toBe(true);
			expect(Buffer.from(bytes).includes(PNG)).toBe(true);
		} else {
			const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
			try {
				const tags = await input.getMetadataTags();
				expect(tags.title).toBe('東京 — Episode');
				expect(tags.artist).toBe('Élodie');
				expect(tags.genre).toBe('Ambient');
				expect(tags.images).toHaveLength(1);
				expect(Buffer.from(tags.images[0].data)).toEqual(PNG);
				expect(tags.raw[format === 'MP3' || format === 'WAV' ? 'TCOM' : 'COMPOSER'], `${format}: ${Object.keys(tags.raw).join(', ')}`).toBe('Renée');
			} finally { input.dispose(); }
		}
		await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
	}
});
