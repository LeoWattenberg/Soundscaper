/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, collectClientErrors, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test.describe('video container exporters', () => {
	registerAudioEditorHooks();
	for (const [label, extension, mimeType, source] of [
		['MP4 video', 'mp4', 'video/mp4', videoRetimePreviewMedia.file],
		['WebM video', 'webm', 'video/webm', videoRetimePreviewMedia.file],
		['MP4 video', 'mp4', 'video/mp4', createDeterministicSilentVideoFixture('recorded.webm')],
		['WebM video', 'webm', 'video/webm', createDeterministicSilentVideoFixture('recorded.webm')],
	]) {
		test(`${label} downloads a playable container from ${source.name}`, async ({ page }) => {
			test.setTimeout(90000);
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/framescaper/embed/en/');
			const sourceDuration = await page.evaluate(async ({ data, type }) => {
				const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type }));
				const video = document.createElement('video');
				try {
					await new Promise((resolve, reject) => {
						video.onloadedmetadata = resolve;
						video.onerror = () => reject(new Error('The source container is not playable.'));
						video.src = url;
					});
					return video.duration;
				} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
			}, { data: Array.from(source.buffer), type: source.mimeType });
			await importFiles(editor, [source]);
			const dialog = await openExportDialog(page, editor, { label: 'Export video' });
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), label);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			await expect(link.filter({ visible: true }).or(editor.locator('[data-status][data-state="error"]'))).toBeVisible({ timeout: 60000 });
			await expect(link).toBeVisible();
			await expect(link).toHaveAttribute('download', new RegExp(`\\.${extension}$`));
			const bytes = await readDownloadBytes(page, link);
			const metadata = await page.evaluate(async ({ data, type }) => {
				const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type }));
				const video = document.createElement('video');
				try {
					await new Promise((resolve, reject) => {
						video.onloadeddata = resolve;
						video.onerror = () => reject(new Error('The exported container is not playable.'));
						video.src = url;
					});
					return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
				} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
			}, { data: Array.from(bytes), type: mimeType });
			// Delivery rounds the final partial frame up to its frame-rate boundary.
			expect(metadata.duration).toBeGreaterThanOrEqual(sourceDuration - 0.01);
			expect(metadata.duration).toBeLessThan(sourceDuration + 0.1);
			expect(metadata.width).toBeGreaterThan(0);
			expect(metadata.height).toBeGreaterThan(0);
			expect(errors).toEqual([]);
		});
	}
});
