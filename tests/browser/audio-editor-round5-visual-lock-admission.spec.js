/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';

test('selected video adjustment refuses a locked owner and works after unlocking', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('locked-video.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.press('Enter');
	const trackId = await clip.evaluate(node => node.closest('[data-track-id]')?.getAttribute('data-track-id'));
	expect(trackId).toBeTruthy();
	const row = editor.locator(`[data-track-row][data-track-id="${trackId}"]`).first();
	await chooseTrackMenuAction(page, editor, row, 'Lock track');
	const open = async () => { await chooseNestedCommandAction(page, editor, 'Tracks', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoAdjustmentLayer']]); };
	await open();
	const dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await expect(dialog.getByRole('button', { name: 'Apply adjustment', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('spinbutton', { name: 'Brightness', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseTrackMenuAction(page, editor, row, 'Unlock track');
	await open();
	await dialog.getByRole('spinbutton', { name: 'Brightness', exact: true }).fill('0.4');
	await dialog.getByRole('button', { name: 'Apply adjustment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await open();
	await expect(dialog.getByRole('spinbutton', { name: 'Brightness', exact: true })).toHaveValue('0.4');
	await expect(dialog.getByRole('button', { name: 'Update adjustment', exact: true })).toBeEnabled();
});
