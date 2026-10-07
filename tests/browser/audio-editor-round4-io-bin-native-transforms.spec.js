/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('a source-trimmed video retains its trim transformation in Project Bin', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('trimmed-take.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const card = editor.locator('[data-project-bin-item]').first();
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(card).toBeVisible();
	await expect(card.locator('.kw-audio-editor__project-bin-badges')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clip).toBeVisible();
	await clip.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:12');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Trim left edge to playhead']);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(card).toBeVisible();
	await expect(card.locator('.kw-audio-editor__project-bin-badges')).toContainText('Trimmed');
});
