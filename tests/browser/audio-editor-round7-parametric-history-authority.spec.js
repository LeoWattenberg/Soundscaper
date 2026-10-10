/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, collectClientErrors, commitInput,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('an authored Undo retires a held Parametric EQ rack band draft', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Parametric EQ');
	const eq = page.locator('[data-parametric-eq]');
	const band = eq.locator('.audio-editor-parametric-eq__handle').first();
	const gain = eq.getByRole('region', { name: 'Selected band', exact: true }).getByLabel('Gain (dB)', { exact: true });
	await commitInput(gain, '4');
	await expect(gain).toHaveValue('4');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(gain).toHaveValue('0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(gain).toHaveValue('4');
	await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	const box = await band.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 3 });
	await expect.poll(async () => Number(await gain.inputValue())).toBeGreaterThan(4);
	await page.keyboard.press('Control+z');
	await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await expect(gain).toHaveValue('0');
	await expect(band).toHaveAttribute('aria-label', /, 0\.0 dB,/u);
	await page.mouse.up();
	await expect(gain).toHaveValue('0');
	await expect(page.getByRole('alert')).toHaveCount(0);
	const fresh = await band.boundingBox();
	expect(fresh).not.toBeNull();
	await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2);
	await page.mouse.down();
	await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2 - 12, { steps: 3 });
	await page.mouse.up();
	const completed = await gain.inputValue();
	expect(Number(completed)).toBeGreaterThan(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(gain).toHaveValue('0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(gain).toHaveValue(completed);
	expect(errors).toEqual([]);
});
