/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

test('choosing letterbox after a vertical delivery target keeps the source visible', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Delivery target', exact: true }), 'Vertical 1080x1920');
	// A small portrait canvas keeps the actual encoder regression inexpensive.
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('54');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('96');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Fit', exact: true }), 'Fit inside (letterbox)');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 60_000 });
	const bytes = await readDownloadBytes(page, link);
	const pixel = await page.evaluate(async (data) => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/mp4' }));
		const video = document.createElement('video');
		try {
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve;
				video.onerror = () => reject(new Error('The exported video could not be decoded.'));
				video.src = url;
			});
			await new Promise((resolve) => {
				video.onseeked = resolve;
				video.currentTime = 0.1;
			});
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const context = canvas.getContext('2d');
			context.drawImage(video, 0, 0);
			return {
				top: [...context.getImageData(27, 5, 1, 1).data],
				center: [...context.getImageData(27, 48, 1, 1).data],
			};
		} finally {
			video.removeAttribute('src');
			video.load();
			URL.revokeObjectURL(url);
		}
	}, [...bytes]);
	// The source is coloured; the top margin of a letterboxed portrait is black.
	expect(pixel.center.slice(0, 3).some((channel) => channel > 100)).toBe(true);
	expect(pixel.top.slice(0, 3).every((channel) => channel < 8)).toBe(true);
});

