/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const freeze of [false, true]) test(`ordinary Project bin video preview preserves ${freeze ? 'an authored freeze' : 'continuous playback'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('bin-retime.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.focus(); await clip.press('Enter');
	if (freeze) {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await dialog.getByRole('textbox', { name: 'Source frame', exact: true }).fill('2');
		await dialog.getByRole('button', { name: 'Apply freeze', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Video retime updated.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: bin-retime', exact: true });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	await expect.poll(() => media.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
	if (freeze) {
		expect(await media.evaluate(video => video.paused)).toBe(true);
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(2 / 30, 5);
		await card.getByRole('button', { name: /^Pause:/u }).click();
		await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(2 / 30, 5);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
		await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible({ timeout: 5_000 });
		await expect(media).toHaveCount(0);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
		expect(await media.evaluate(video => video.paused)).toBe(true);
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(2 / 30, 5);
	} else {
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeGreaterThan(0.03);
		expect(await media.evaluate(video => video.paused)).toBe(false);
	}
	await card.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	await page.getByRole('alertdialog', { name: 'Remove from project', exact: true })
		.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toHaveCount(0);
});
