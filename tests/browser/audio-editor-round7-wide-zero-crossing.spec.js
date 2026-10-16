/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('At zero crossings listens to the occupied channels of an ordinary surround recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const mono = createWavFixture({ name: 'reference-channel.wav', frequency: 197, duration: 1, channelCount: 1 });
	const surround = createWavFixture({ name: 'surround-take.wav', frequency: 197, duration: 1, channelCount: 6 });
	for (let frame = 0; frame < 48_000; frame++) for (let channel = 0; channel < 6; channel++) {
		surround.buffer.writeInt16LE(channel < 2 ? 0 : mono.buffer.readInt16LE(44 + frame * 2), 44 + (frame * 6 + channel) * 2);
	}
	await importFiles(editor, [mono, surround]);
	async function align(name) {
		const box = await clipByName(editor, name).locator('.clip-display').boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box.x + box.width * .2, box.y + box.height * .65);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * .6, box.y + box.height * .65, { steps: 4 });
		await page.mouse.up();
		for (const [edge, value] of [['end', 30_007], ['start', 10_007]]) {
			const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
			await field.locator('.timecode__format-button').click();
			await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
			const digits = field.locator('.timecode-digit');
			await expect(digits).toHaveCount(12);
			await digits.first().click();
			await page.keyboard.type(String(value).padStart(12, '0'));
			await page.keyboard.press('Enter');
			await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(value);
		}
		await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
		await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
		return await Promise.all(['start', 'end'].map(async edge => Number((await editor
			.getByRole('group', { name: `Selection ${edge}`, exact: true }).locator('.timecode-digit').allTextContents()).join(''))));
	}
	const reference = await align(mono.name);
	expect(reference[0]).not.toBe(10_007);
	expect(reference[1]).not.toBe(30_007);
	await align(surround.name);
	await expect.poll(async () => await Promise.all(['start', 'end'].map(async edge => Number((await editor
		.getByRole('group', { name: `Selection ${edge}`, exact: true }).locator('.timecode-digit').allTextContents()).join(''))))).toEqual(reference);
});
