/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, importFiles,
	openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist preview preserves the relative placement of two header-selected clips', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round3NyquistPreviewDurations = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) window.__round3NyquistPreviewDurations.push(this.buffer.duration);
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	const properties = await openClipProperties(page, editor, second);
	await properties.getByText('Media settings', { exact: true }).click();
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000400');
	await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m00.400s');
	await closeClipProperties(properties);
	await first.locator('.clip-header').click();
	await second.locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(first.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(second.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('*track*');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round3NyquistPreviewDurations.at(-1)),
		{ timeout: 20_000 }).toBeCloseTo(1.2, 3);
});
