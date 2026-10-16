/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('a video opacity fade completes at primary release with middle held', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('opacity-primary-release.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	const value = async () => Number(await fade.getAttribute('aria-valuenow'));
	const box = await fade.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const final = { ...first, x: first.x + 20 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(value).toBeGreaterThan(0);
	const completed = await value();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await expect.poll(value).toBeCloseTo(completed, 6);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await page.mouse.move(first.x + 40, first.y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect.poll(value).toBeCloseTo(completed, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(value).toBeCloseTo(completed, 6);
});
