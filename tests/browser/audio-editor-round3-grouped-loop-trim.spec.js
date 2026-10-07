/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const input of ['keyboard', 'pointer']) test(`a grouped loop trim shares the repeat period using ${input}`,  async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['lead-loop.wav', 'rhythm-loop.wav'].map(name => createWavFixture({ name, duration: 0.8, frequency: 440, channelCount: 1 }));
	await importFiles(editor, files);
	for (const file of files) {
		const clip = clipByName(editor, file.name);
		await clip.locator('.clip-header').click();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	}
	const first = clipByName(editor, files[0].name);
	await first.locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	if (input === 'keyboard') {
		await first.focus();
		await first.press('Control+Shift+ArrowLeft');
	} else {
		const handle = await first.getByRole('button', { name: 'Trim right edge', exact: true }).boundingBox();
		const display = await first.locator('.clip-display').boundingBox();
		expect(handle).not.toBeNull(); expect(display).not.toBeNull();
		const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
		await page.mouse.move(x, y); await page.mouse.down();
		await page.mouse.move(x - display.width / 16, y, { steps: 5 }); await page.mouse.up();
	}
	const period = await first.locator('[data-loop-boundary-frame]').first().getAttribute('data-loop-boundary-frame');
	if (input === 'keyboard') expect(period).toBe('33600');
	else expect(Number(period)).toBeLessThan(34400);
	for (const file of files) await expect(clipByName(editor, file.name).locator('[data-loop-boundary-frame]').first()).toHaveAttribute('data-loop-boundary-frame', period);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	for (const file of files) await expect(clipByName(editor, file.name).locator('[data-loop-boundary-frame]').first()).toHaveAttribute('data-loop-boundary-frame', '38400');
});
