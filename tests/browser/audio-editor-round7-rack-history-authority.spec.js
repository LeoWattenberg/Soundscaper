/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, collectClientErrors, commitInput,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('an undone Feedback delay parameter retires its held native rack knob draft', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'ordinary delay history.wav', duration: 2,
		frequency: 1000, channelCount: 1, channelAmplitudes: [.2] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Feedback delay');
	const dialog = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	const parameter = dialog.locator('[data-effect-param="mix"]');
	const number = parameter.locator('input[type="number"]');
	await commitInput(number, '0.4');
	await expect(number).toHaveValue('0.4');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(number).toHaveValue('0.2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(number).toHaveValue('0.4');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const knob = parameter.getByRole('slider');
	const box = await knob.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2);
	await expect(knob).not.toHaveAttribute('aria-valuenow', '0.4');
	await page.keyboard.press('Control+z');
	await expect(number).toHaveValue('0.2');
	await expect(knob).toHaveAttribute('aria-valuenow', '0.2');
	await page.mouse.up();
	await expect(number).toHaveValue('0.2');
	await expect(page.getByRole('alert')).toHaveCount(0);
	const fresh = await knob.boundingBox();
	expect(fresh).not.toBeNull();
	await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2);
	await page.mouse.down();
	await page.mouse.move(fresh.x + fresh.width / 2 + 12, fresh.y + fresh.height / 2);
	await page.mouse.up();
	await expect(number).toHaveValue('0.26');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(number).toHaveValue('0.2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(number).toHaveValue('0.26');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});
