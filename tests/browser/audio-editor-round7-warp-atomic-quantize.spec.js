/* SPDX-License-Identifier: AGPL-3.0-only */

import { round7DrumWav } from '../helpers/round7-warp-drums.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('one Quantize click and one Undo restore an ordinary drum clip without a hidden identity edit', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Drums.wav', mimeType: 'audio/wav', buffer: round7DrumWav() }]);
	const clip = clipByName(editor, 'Drums.wav');
	await clip.locator('.clip-header').click();
	const projectId = await editor.getAttribute('data-project-id');
	async function savedMap() {
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		return (await persistedProject(page, projectId)).clips[0].warpMap ?? null;
	}
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	const createIdentity = dialog.getByRole('button', { name: 'Create identity warp map', exact: true });
	async function historyStep(name) {
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name, exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	}
	await expect(createIdentity).toBeEnabled();
	await createIdentity.click();
	await expect(createIdentity).toBeDisabled();
	await historyStep('Undo');
	await expect(createIdentity).toBeEnabled();
	expect(await savedMap()).toBeNull();
	const grid = dialog.getByRole('group', { name: 'Grid interval', exact: true });
	const digits = grid.locator('.timecode-digit');
	await expect(digits).toHaveCount(12);
	await digits.first().click(); await page.keyboard.type('000000012000'); await page.keyboard.press('Enter');
	await dialog.getByRole('button', { name: 'Quantize transients', exact: true }).click();
	await expect(dialog).toContainText('Transients quantized.');
	const authored = await savedMap();
	expect(authored.points.length).toBeGreaterThan(2);
	await historyStep('Undo');
	await expect(createIdentity).toBeEnabled();
	expect(await savedMap()).toBeNull();
	await historyStep('Redo');
	await expect(createIdentity).toBeDisabled();
	expect(await savedMap()).toEqual(authored);
});
