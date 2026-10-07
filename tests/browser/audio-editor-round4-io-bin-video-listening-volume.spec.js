/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Project Bin camera audition respects the playback listening volume', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera-audition.webm')]);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.focus();
	await volume.press('Home');
	await expect(volume).toHaveValue('0');
	await editor.getByRole('group', { name: /^Video clip:/u }).first().click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: camera-audition', exact: true });
	await expect(card).toContainText('With audio');
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	expect(await media.evaluate(element => element.volume)).toBe(0);
	await card.getByRole('button', { name: /^Pause:/u }).click();
	await volume.focus();
	await volume.press('End');
	await expect(volume).toHaveValue('1');
	await expect(media).toHaveJSProperty('volume', 1);
	await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
});
