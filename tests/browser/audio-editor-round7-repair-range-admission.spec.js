/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	getMenuItem, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('Repair keeps its supported short selection and suspends a longer ordinary range', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'recording with a click.wav', frequency: 750,
		duration: 1, sampleRate: 48_000, channelCount: 1 });
	recording.buffer.writeInt16LE(30_000, 44 + 12_016 * 2);
	await importFiles(editor, [recording]);
	const box = await clipByName(editor, recording.name).locator('.clip-display').boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * .2, box.y + box.height * .65);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .4, box.y + box.height * .65, { steps: 4 });
	await page.mouse.up();
	async function setEdge(edge, value) {
		const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
		await field.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const digits = field.locator('.timecode-digit');
		const text = String(value).padStart(12, '0');
		for (let index = text.length - 1; index >= 0; index--) {
			await digits.nth(index).click();
			await page.keyboard.press(text[index]);
		}
		await page.keyboard.press('Enter');
		await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(value);
	}
	await setEdge('end', 24_000);
	await setEdge('start', 12_000);
	await setEdge('end', 12_064);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Repair']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await setEdge('end', 12_129);
	const noise = await openNestedCommandMenu(page, editor, 'Effect', ['Noise removal and repair']);
	const repair = getMenuItem(noise, 'Repair');
	if (await repair.getAttribute('aria-disabled') === 'false') {
		await repair.click();
		await expect(editor.getByRole('alert')).toContainText(
			'Repair is intended for damaged selections of at most 128 samples.');
		await editor.getByRole('region', { name: 'Unknown error', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
		await openNestedCommandMenu(page, editor, 'Effect', ['Noise removal and repair']);
	}
	await expect(repair).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await setEdge('end', 12_128);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Repair']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
