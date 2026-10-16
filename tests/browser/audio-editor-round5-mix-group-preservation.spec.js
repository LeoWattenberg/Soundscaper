/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('mixing one track preserves a grouped recording on an unselected track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['mix-lead.wav', 'unselected-peer.wav'].map((name, index) =>
		createWavFixture({ name, frequency: index ? 660 : 440, channelCount: 1, duration: 0.8 }));
	await importFiles(editor, files);
	const lead = clipByName(editor, files[0].name);
	const companion = clipByName(editor, files[1].name);
	await lead.locator('.clip-header').click();
	await companion.locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await lead.locator('xpath=ancestor::div[@data-track-row]').locator('.track-control-panel__track-name-text').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect(clipByName(editor, 'mix-lead')).toBeVisible();
	await expect(companion).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(lead).toBeVisible();
	await expect(companion).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(companion).toBeVisible();
});
