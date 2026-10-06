/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Escape cancels a video opacity fade before pointer release', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('fade-session.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await fade.focus();
	const box = await fade.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
	await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	await page.keyboard.press('Escape');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await page.mouse.up();
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
});
