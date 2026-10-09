/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

function field(editor, edge) {
	return editor.getByRole('group', { name: `Selection ${edge}`, exact: true }).locator('.timecode__display');
}

for (const selectedClip of [false, true]) {
	test(`vertical track selection retains ${selectedClip ? 'selected clip bounds' : 'off-grid boundaries and an independent playhead'}`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone, toneB]);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const clip = clipByName(editor, longTone.name);
		if (selectedClip) await clip.locator('.clip-header').click();
		else {
			const box = await clip.locator('.clip-display').boundingBox();
			expect(box).not.toBeNull();
			const xAt = seconds => box.x + box.width * seconds / 8;
			const y = box.y + box.height * 0.75;
			await page.mouse.move(xAt(0.2), y);
			await page.mouse.down();
			await page.mouse.move(xAt(0.6), y, { steps: 4 });
			await page.mouse.up();
			await expect(field(editor, 'start')).toHaveText('00h00m00.200s');
			await expect(field(editor, 'end')).toHaveText('00h00m00.600s');
		}
		await showToolbarButton(page, editor, 'Snap');
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		await playhead.press('Home');
		await playhead.press('Shift+ArrowRight');
		const position = await playhead.getAttribute('aria-valuenow');
		const row = clip.locator('xpath=ancestor::div[@data-track-row][1]')
			.getByRole('group', { name: 'Track 2, audio track', exact: true });
		await row.press('Shift+ArrowDown');
		await expect(field(editor, 'start')).toHaveText(selectedClip ? '00h00m00.000s' : '00h00m00.200s');
		await expect(field(editor, 'end')).toHaveText(selectedClip ? '00h00m08.000s' : '00h00m00.600s');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
		await expect(playhead).toHaveAttribute('aria-valuenow', position);
	});
}
