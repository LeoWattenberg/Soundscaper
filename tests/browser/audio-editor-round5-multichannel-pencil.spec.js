/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

async function exportChannels(page, editor) {
	const dialog = await openExportDialog(page, editor);
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const channels = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			return Array.from({ length: audio.numberOfChannels }, (_, index) => Array.from(audio.getChannelData(index)));
		} finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return channels;
}

test('Pencil edits the visible right channel of a normal multichannel recording', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'six-channel-pencil.wav', frequency: 1000,
		duration: 0.002, channelCount: 6, channelAmplitudes: [0, 0, 0, 0, 0, 0] });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const body = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	expect(body).not.toBeNull(); expect(canvas).not.toBeNull();
	await page.mouse.click(body.x + 32.1 / 96 * body.width, canvas.y + canvas.height * 0.625);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	const channels = await exportChannels(page, editor);
	expect(channels).toHaveLength(2);
	expect(channels[1][32]).toBeGreaterThan(0.1);
	expect(channels[0][32]).toBeCloseTo(0, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect((await exportChannels(page, editor))[1][32]).toBe(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect((await exportChannels(page, editor))[1][32]).toBeGreaterThan(0.1);
});
