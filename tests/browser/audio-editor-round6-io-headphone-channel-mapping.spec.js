/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, closeWorkspacePanel, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const choice of ['mono', 'headphone-mono', 'headphone-empty-custom']) test(`headphone routing respects the ordinary ${choice} workflow`, async ({ page }, testInfo) => {
	const headphones = choice !== 'mono';
	const mapping = choice === 'headphone-empty-custom' ? 'custom' : 'mono';
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	const dialog = await openExportDialog(page, editor);
	const mono = dialog.locator('[data-export-channel-option="mono"] input');
	const prior = dialog.locator(`[data-export-channel-option="${mapping}"] input`);
	await prior.check();
	await expect(prior).toBeChecked();
	if (headphones) await dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true }).check();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	const audio = await page.evaluate(async (data) => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
			return { channels: buffer.numberOfChannels, frames: buffer.length, peak: Math.max(...buffer.getChannelData(0)) };
		} finally { await context.close(); }
	}, Array.from(bytes));
	await testInfo.attach('actual-delivery.json', { body: JSON.stringify({ ...audio, displayedMono: await mono.isChecked() }), contentType: 'application/json' });
	expect(audio.channels).toBe(headphones ? 2 : 1);
	expect(audio.frames).toBe(38_400);
	expect(audio.peak).toBeGreaterThan(.05);
	if (headphones) {
		await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeChecked();
		await expect(mono).not.toBeChecked();
		await expect(mono).toBeDisabled();
		await dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true }).uncheck();
		await expect(prior).toBeChecked();
		await expect(prior).toBeEnabled();
	}
});
