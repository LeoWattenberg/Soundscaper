/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { openExportDialog, readDownloadBytes } from '../audio-editor-test-helpers.js';

export async function exportSamples(page, editor) {
	const dialog = await openExportDialog(page, editor);
	const link = dialog.locator('[data-export-download]');
	const previousDownload = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previousDownload);
	const bytes = await readDownloadBytes(page, link);
	const samples = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			return Array.from(audio.getChannelData(0));
		} finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return samples;
}
