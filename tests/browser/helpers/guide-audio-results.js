/* SPDX-License-Identifier: AGPL-3.0-only */

import { chooseDropdown, closeDialog, downloadBytes, openExportDialog } from '../audio-editor-test-helpers.js';

/** Export the current project as WAV and return decoded samples for result assertions. */
export async function exportGuideSamples(page) {
	const editor = page.locator('[data-audio-editor]');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const downloadLink = dialog.locator('[data-export-download]');
	await downloadLink.waitFor({ state: 'visible', timeout: 60_000 });
	const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
	const bytes = await downloadBytes(download);
	await closeDialog(dialog);
	return page.evaluate(async (encoded) => {
		const bytes = Uint8Array.from(encoded);
		const context = new OfflineAudioContext(2, 1, 48_000);
		const audio = await context.decodeAudioData(bytes.buffer.slice(0));
		return {
			sampleRate: audio.sampleRate,
			duration: audio.duration,
			channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => Array.from(audio.getChannelData(channel))),
		};
	}, Array.from(bytes));
}
