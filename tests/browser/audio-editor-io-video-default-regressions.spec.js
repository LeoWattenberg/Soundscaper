/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

test('an invalid typed video canvas size is refused instead of exporting the automatic size', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const dialog = await openExportDialog(page, editor);
	await chooseMp4Video(page, dialog);
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('96');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText(/canvas|width|size/iu);
	await expect(dialog.locator('[data-export-download]')).not.toBeVisible();
});

test('a saved video preset tolerates an invalid canvas draft while refusing submission', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const dialog = await openExportDialog(page, editor);
	await chooseMp4Video(page, dialog);
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('54');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('96');
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Small portrait');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('Small portrait');
	const width = dialog.getByRole('spinbutton', { name: 'Width', exact: true });
	await width.fill('0');
	await expect(width).toHaveValue('0');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText(/canvas|width|size/iu);
	await expect(dialog.locator('[data-export-download]')).not.toBeVisible();
	await width.fill('54');
	await expect(dialog.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('96');
});

test('choosing letterbox after a vertical delivery target keeps the source visible', async ({ page }) => {
	test.setTimeout(90_000);
	await requireWebgl2(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const dialog = await openExportDialog(page, editor);
	await chooseMp4Video(page, dialog);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Delivery target', exact: true }), 'Vertical 1080x1920');
	// A small portrait canvas keeps the actual encoder regression inexpensive.
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('54');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('96');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Fit', exact: true }), 'Fit inside (letterbox)');
	const pixel = await readExportedPixelEvidence(page, dialog);
	// The source is coloured; the top margin of a letterboxed portrait is black.
	expect(pixel.center.slice(0, 3).some((channel) => channel > 100), JSON.stringify(pixel)).toBe(true);
	expect(pixel.top.slice(0, 3).every((channel) => channel < 8)).toBe(true);
});

test('resizing a video export preserves its source picture while the private decoder stays invisible', async ({ page }) => {
	test.setTimeout(90_000);
	await requireWebgl2(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const dialog = await openExportDialog(page, editor);
	await chooseMp4Video(page, dialog);
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('54');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('96');
	const pixel = await readExportedPixelEvidence(page, dialog);
	expect(pixel.center.slice(0, 3).some((channel) => channel > 100), JSON.stringify(pixel)).toBe(true);
	expect(pixel.top.slice(0, 3).every((channel) => channel < 8)).toBe(true);
});

async function requireWebgl2(page) {
	const webgl2Available = await page.evaluate(() => {
		const context = document.createElement('canvas').getContext('webgl2');
		if (!context) return false;
		context.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	});
	test.skip(!webgl2Available, 'The encoded-pixel regression needs WebGL2; this headless host disables its creation.');
}

async function chooseMp4Video(page, dialog) {
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
}

async function readExportedPixelEvidence(page, dialog) {
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link.filter({ visible: true }).or(page.locator(
		'[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]',
	))).toBeVisible({ timeout: 60_000 });
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const videoPath = test.info().outputPath('letterbox.mp4');
	await writeFile(videoPath, bytes);
	await test.info().attach('letterbox-video', { path: videoPath, contentType: 'video/mp4' });
	return readDecodedVideoPixels(page, bytes);
}

export async function readDecodedVideoPixels(page, bytes) {
	return page.evaluate(async (data) => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/mp4' }));
		const video = document.createElement('video');
		Object.assign(video, { muted: true, playsInline: true, preload: 'auto' });
		// A verifier below the editor can be culled before its decoder paints.
		Object.assign(video.style, { position: 'fixed', left: '8px', top: '8px',
			width: '54px', height: '96px', zIndex: '2147483647' });
		document.body.append(video);
		let callback = null;
		try {
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve;
				video.onerror = () => reject(new Error('The exported video could not be decoded.'));
				video.src = url;
			});
			// Seek completion alone does not promise a drawable decoded picture.
			const presented = new Promise((resolve) => {
				const onFrame = (_now, metadata) => {
					if (metadata.mediaTime > 0 && metadata.mediaTime <= 0.1) resolve(metadata);
					else callback = video.requestVideoFrameCallback(onFrame);
				};
				callback = video.requestVideoFrameCallback(onFrame);
			});
			const seeked = new Promise((resolve) => {
				video.onseeked = resolve;
			});
			video.currentTime = 0.1;
			const [frame] = await Promise.all([presented, seeked]);
			callback = null;
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const context = canvas.getContext('2d');
			context.drawImage(video, 0, 0);
			return {
				width: video.videoWidth, height: video.videoHeight, currentTime: video.currentTime,
				presentedTime: frame.mediaTime,
				top: [...context.getImageData(27, 5, 1, 1).data],
				center: [...context.getImageData(27, 48, 1, 1).data],
			};
		} finally {
			if (callback !== null) video.cancelVideoFrameCallback(callback);
			video.removeAttribute('src');
			video.load();
			video.remove();
			URL.revokeObjectURL(url);
		}
	}, [...bytes]);
}
