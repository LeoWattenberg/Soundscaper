/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Page } from '@playwright/test';
import { motionWavFixture } from '../helpers/motion-media-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('menu Timeline edits layer timing, groups and nests a title while preserving undo and saved intent', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Animated title');
	await page.getByLabel('Duration in frames', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	for (const [command, name] of [['New Rectangle', 'Card'], ['New Text', 'Title']] as const) {
		await menu(page, 'Layer', command); await page.getByLabel('Layer name', { exact: true }).fill(name);
		if (name === 'Title') await page.getByLabel('Text', { exact: true }).fill('Motion');
		await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	}
	await expect(page.getByRole('dialog', { name: 'Timeline', exact: true })).toHaveCount(0);
	await menu(page, 'View', 'Timeline'); const dialog = page.getByRole('dialog', { name: 'Timeline', exact: true });
	await dialog.getByRole('checkbox', { name: 'Title', exact: true }).check();
	await dialog.getByLabel('In frame', { exact: true }).fill('5'); await dialog.getByLabel('Out frame', { exact: true }).fill('50');
	await dialog.getByRole('button', { name: 'Trim', exact: true }).click();
	const title = dialog.locator('[data-motion-layer-row]').filter({ has: page.getByRole('checkbox', { name: 'Title', exact: true }) });
	await expect(title).toHaveAttribute('data-motion-in', '5/1');
	await title.getByRole('button', { name: 'Title timing', exact: true }).focus(); await page.keyboard.press('ArrowRight');
	await expect(title).toHaveAttribute('data-motion-in', '6/1');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(title).toHaveAttribute('data-motion-in', '5/1');
	const bar = title.getByRole('button', { name: 'Title timing', exact: true }); const box = await bar.boundingBox();
	const track = await bar.locator('..').boundingBox(); if (!box || !track) throw new Error('Timeline bar is unavailable.');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + track.width / 60 * 4, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
	await expect(title).toHaveAttribute('data-motion-in', '9/1');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(title).toHaveAttribute('data-motion-in', '5/1');
	await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click(); await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(2);
	await dialog.getByLabel('Split at frame', { exact: true }).fill('25'); await dialog.getByRole('button', { name: 'Split', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(2);
	await dialog.getByRole('button', { name: 'Lower Layer', exact: true }).click();
	await expect(dialog.getByRole('checkbox').first()).toHaveAccessibleName('Card');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(dialog.getByRole('checkbox').first()).toHaveAccessibleName('Title');

	await dialog.getByRole('checkbox', { name: 'Card', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title group');
	await dialog.getByRole('button', { name: 'Group with Null', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3);
	await dialog.getByRole('checkbox', { name: 'Title group', exact: true }).check();
	await dialog.getByLabel('Group name', { exact: true }).fill('Title scene');
	await dialog.getByRole('button', { name: 'Precompose', exact: true }).click();
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(1);
	await dialog.getByLabel('Composition', { exact: true }).selectOption({ label: 'Title scene' });
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3);
	await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'View', exact: true })).toBeFocused();
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'File', 'Project Library'); await page.getByRole('button', { name: 'Animated title', exact: true }).click();
	await menu(page, 'View', 'Timeline'); await dialog.getByLabel('Composition', { exact: true }).selectOption({ label: 'Title scene' });
	await expect(dialog.locator('[data-motion-layer-row]')).toHaveCount(3); await expect(title).toHaveAttribute('data-motion-in', '5/1');
});


test('Timeline audio edits preserve independent gain, timing and undo', async ({ page }: { page: Page }) => {
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(motionWavFixture(2, 48000)) });
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'View', 'Timeline');
	const dialog = page.getByRole('dialog', { name: 'Timeline', exact: true }); const audio = dialog.locator('[data-motion-audio-editor]');
	await audio.getByLabel('Base gain (%)', { exact: true }).fill('50'); await audio.getByRole('button', { name: 'Apply Gain', exact: true }).click();
	await expect(audio).toHaveAttribute('data-motion-gain', '0.5');
	await audio.getByLabel('Move by frames', { exact: true }).fill('3'); await audio.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(audio).toHaveAttribute('data-motion-in', '3/1');
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(audio).toHaveAttribute('data-motion-in', '0/1');
	await expect(audio).toHaveAttribute('data-motion-gain', '0.5');
	await audio.getByLabel('In frame', { exact: true }).fill('2'); await audio.getByLabel('Out frame', { exact: true }).fill('20');
	await audio.getByRole('button', { name: 'Trim', exact: true }).click(); await expect(audio).toHaveAttribute('data-motion-in', '2/1');
	await audio.getByLabel('Audio enabled', { exact: true }).click(); await expect(audio).toHaveAttribute('data-motion-enabled', 'false');
	await audio.getByRole('button', { name: 'Remove Audio', exact: true }).click(); await expect(audio).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(audio).toHaveCount(1);
	await expect(audio).toHaveAttribute('data-motion-gain', '0.5'); await expect(audio).toHaveAttribute('data-motion-in', '2/1');
});
