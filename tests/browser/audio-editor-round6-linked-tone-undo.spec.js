/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const parameter of ['bassDb', 'trebleDb']) test(`one Undo restores an ordinary linked ${parameter} edit and its compensated volume`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Bass and Treble');
	const dialog = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
	const tone = dialog.locator(`[data-effect-param="${parameter}"] input`);
	const volume = dialog.locator('[data-effect-param="volumeDb"] input');
	const reopen = async () => {
		await panel.getByRole('group', { name: 'Bass and Treble', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		await expect(dialog).toBeVisible();
	};
	await commitInput(tone, '3');
	await expect(tone).toHaveValue('3');
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await reopen();
	await expect(tone).toHaveValue('0');
	await expect(volume).toHaveValue('0');
	await dialog.getByRole('checkbox', { name: 'Auto-adjust volume to preserve loudness', exact: true }).check();
	await commitInput(tone, '12');
	await expect(tone).toHaveValue('12');
	await expect(volume).toHaveValue('-6');
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await reopen();
	console.log('Linked tone after one native Undo', { parameter, tone: await tone.inputValue(), volume: await volume.inputValue() });
	await expect(tone).toHaveValue('0');
	await expect(volume).toHaveValue('0');
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await reopen();
	await expect(tone).toHaveValue('12');
	await expect(volume).toHaveValue('-6');
});
