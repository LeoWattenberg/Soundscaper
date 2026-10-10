/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Undo of video opacity retires a held fade and preserves Redo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('opacity-history.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	const value = async () => Number(await fade.getAttribute('aria-valuenow'));
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	const beginFade = async () => {
		const box = await fade.boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 20, y, { steps: 4 });
	};
	await beginFade();
	await page.mouse.up();
	await expect.poll(value).toBeGreaterThan(0);
	const completed = await value();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(value).toBeCloseTo(completed, 6);
	await beginFade();
	await expect.poll(value).toBeGreaterThan(completed);
	await page.keyboard.press('Control+z');
	await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await page.mouse.up();
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(value).toBeCloseTo(completed, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
