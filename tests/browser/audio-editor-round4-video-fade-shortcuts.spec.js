/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Undo reaches the timeline from a focused video opacity fade', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('fade-shortcuts.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	await clip.press('Tab');
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toBeFocused();
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await clip.press('Enter');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
});

test('Tab traverses video fade handles and the next clip in both directions', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('fade-navigation.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clips = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clips).toHaveCount(1);
	await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	const bounds = await clips.first().boundingBox();
	expect(bounds).not.toBeNull();
	await page.keyboard.down('Control');
	await page.mouse.move(bounds.x + 32, bounds.y + 10);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width + 64, bounds.y + 10, { steps: 6 });
	await page.mouse.up();
	await page.keyboard.up('Control');
	await expect(clips).toHaveCount(2);
	await clips.first().locator('.clip-header').click();
	await clips.first().press('Tab');
	const fadeIn = clips.first().getByRole('slider', { name: 'Fade in', exact: true });
	const fadeOut = clips.first().getByRole('slider', { name: 'Fade out', exact: true });
	await expect(fadeIn).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(fadeOut).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(clips.last()).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(fadeOut).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(fadeIn).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(clips.first()).toBeFocused();
});
