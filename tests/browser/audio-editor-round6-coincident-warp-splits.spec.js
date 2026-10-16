/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const warped of [false, true]) test(`Labeled Split coalesces ${warped ? 'warped' : 'plain'} editable cut positions`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'labeled-split.wav', channelCount: 1, duration: 1 });
	await importFiles(editor, [recording]);
	const clips = clipByName(editor, recording.name);
	if (warped) {
		await clips.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('24000');
		await warp.getByLabel('Source sample', { exact: true }).fill('12000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('12000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	await editor.getByRole('button', { name: 'Playhead: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	for (const position of [23998, 23999]) {
		const digits = playhead.locator('.timecode-digit');
		await expect(digits).toHaveCount(12);
		await digits.first().click();
		await page.keyboard.type(String(position).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(position);
		await page.keyboard.press('Control+b');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
		await title.fill(`Cut ${position}`);
		await title.press('Enter');
	}
	await expect(editor.locator('[data-label-id]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Split']);
	await expect(clips).toHaveCount(warped ? 2 : 3);
	await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(warped ? 2 : 3);
});
