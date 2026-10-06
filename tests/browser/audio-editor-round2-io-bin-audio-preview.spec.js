/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Project Bin video preview does not restore audio removed through the timeline', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('removed-audio.webm')]);
	const video = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await video.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	const audio = editor.getByRole('group', { name: /^removed-audio Audio clip,/u });
	await expect(audio).toBeVisible();
	await audio.press('Enter');
	await audio.press('Delete');
	await expect(audio).toHaveCount(0);
	await video.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toContainText('No audio');
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	await expect.poll(() => media.evaluate(element => element.muted)).toBe(true);
});
