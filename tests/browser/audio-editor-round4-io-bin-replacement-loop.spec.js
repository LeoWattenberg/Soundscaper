/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeDialog, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('replacing a loop source with a shorter recording retains the authored repetitions', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const adding = page.waitForEvent('filechooser');
	await editor.locator('button').getByText('Add audio to Project bin', { exact: true }).click();
	await (await adding).setFiles(monoTone);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const initialClip = clipByName(editor, monoTone.name);
	await expect(initialClip).toBeVisible();
	const clipId = await initialClip.getAttribute('data-clip-id');
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	await card.getByRole('button', { name: /More file actions/u }).click();
	const replacing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await replacing).setFiles(createWavFixture({ name: 'shorter-take.wav', frequency: 440, duration: 0.4, channelCount: 1 }));
	const choice = page.locator('[data-project-bin-replacement-dialog]');
	await expect(choice).toBeVisible();
	await choice.getByRole('button', { name: 'Keep timeline spacing', exact: true }).click();
	await expect(choice).toBeHidden();
	await expect(clip).toHaveAccessibleName(/0\.8 seconds long$/u);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const amplitudes = await page.evaluate(async (encoded) => {
		const context = new AudioContext();
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(encoded).buffer);
			const samples = decoded.getChannelData(0);
			const start = Math.round(decoded.sampleRate * 0.1);
			const end = Math.round(decoded.sampleRate * 0.3);
			return Object.fromEntries([220, 440].map(frequency => {
				let sine = 0; let cosine = 0;
				for (let frame = start; frame < end; frame++) {
					const angle = 2 * Math.PI * frequency * frame / decoded.sampleRate;
					sine += samples[frame] * Math.sin(angle); cosine += samples[frame] * Math.cos(angle);
				}
				return [frequency, 2 * Math.hypot(sine, cosine) / (end - start)];
			}));
		} finally { await context.close(); }
	}, Array.from(bytes));
	expect(amplitudes[440], JSON.stringify(amplitudes)).toBeGreaterThan(0.1);
	expect(amplitudes[440]).toBeGreaterThan(amplitudes[220] * 8);
	await closeDialog(dialog);
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
});
