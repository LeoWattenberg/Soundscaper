/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

const video = createDeterministicSilentVideoFixture('recorded.webm');
const caption = { name: 'dialogue.srt', mimeType: 'application/x-subrip',
	buffer: Buffer.from('1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n') };

for (const captions of [false, true]) test(`Soundscaper video ${captions ? 'does not offer its refused caption delivery' : 'delivers ordinary video without captions'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [video]);
	await importFiles(editor, [caption]);
	await expect(editor.getByText('A normal caption', { exact: true })).toBeVisible();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
	if (captions) {
		await expect(dialog.getByRole('button', { name: 'Captions from', exact: true })).toHaveCount(0);
		await expect(dialog.locator('[data-export-field="captionDeliveryUnavailable"]')).toContainText('Soundscaper');
		await expect(dialog.locator('[data-export-field="captionDeliveryUnavailable"]')).toContainText('Export labels');
	}
	const webGl2Available = await page.evaluate(hasWebGl2Capability);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	const error = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
	await expect(link.filter({ visible: true }).or(error)).toBeVisible({ timeout: 20_000 });
	if (!webGl2Available) {
		await expect(error).toBeVisible();
		await expect(error).toContainText('WebGL2 is unavailable.');
		await expect(link).toBeHidden();
		return;
	}
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute('download', /\.webm$/u);
	const bytes = await readDownloadBytes(page, link);
	const metadata = await page.evaluate(async data => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
		const media = document.createElement('video');
		try {
			await new Promise((resolve, reject) => { media.onloadeddata = resolve; media.onerror = () => reject(new Error('Delivered video is not playable.')); media.src = url; });
			return { duration: media.duration, width: media.videoWidth, height: media.videoHeight };
		} finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
	}, Array.from(bytes));
	expect(metadata.width).toBe(96);
	expect(metadata.height).toBe(54);
	expect(metadata.duration).toBeGreaterThan(.5);
});
