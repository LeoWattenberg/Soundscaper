/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';

test('a split video retains its selected adjustment controls', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('adjusted-video.webm')]);
	const clips = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clips).toHaveCount(1);
	const originalId = await clips.first().getAttribute('data-clip-id');
	await clips.first().press('Enter');
	await openAdjustment(page, editor);
	let dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await dialog.locator('[data-framescaper-authoring-brightness]').fill('0.5');
	await dialog.getByRole('button', { name: 'Apply adjustment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await clickClipInterior(page, clips.first(), 0.5);
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await expect(clips).toHaveCount(2);
	const left = clips.locator(`:scope[data-clip-id="${originalId}"]`);
	const right = clips.locator(`:scope:not([data-clip-id="${originalId}"])`);
	await right.press('Enter');
	await openAdjustment(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await expect(dialog.locator('[data-framescaper-authoring-brightness]')).toHaveValue('0.5');
	await dialog.locator('[data-framescaper-authoring-brightness]').fill('0.75');
	await dialog.getByRole('button', { name: 'Update adjustment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await left.press('Enter');
	await openAdjustment(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await expect(dialog.locator('[data-framescaper-authoring-brightness]')).toHaveValue('0.5');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await right.press('Enter');
	await openAdjustment(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await expect(dialog.locator('[data-framescaper-authoring-brightness]')).toHaveValue('0.5');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await right.press('Enter');
	await openAdjustment(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	await expect(dialog.locator('[data-framescaper-authoring-brightness]')).toHaveValue('0.75');
	await dialog.getByRole('button', { name: 'Remove adjustment', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Apply adjustment', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await left.press('Enter');
	await openAdjustment(page, editor);
	await expect(page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true })
		.locator('[data-framescaper-authoring-brightness]')).toHaveValue('0.5');
});

async function openAdjustment(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Tracks', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoAdjustmentLayer']]);
}
