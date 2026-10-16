/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

// Track admission, audio import, and rack application share a coverage-enabled budget.
test.describe.configure({ timeout: 120_000 });

test('Dialogue Chain admits the selected audio track and refuses picture and label tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	await editor.getByRole('group', { name: 'Video clip: Title', exact: true }).press('Enter');
	await expectRefusal(page, editor);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
	await expectRefusal(page, editor);
	await importFiles(editor, [createWavFixture({ name: 'ordinary-voice.wav', duration: 1 })]);
	await editor.getByRole('group', { name: /^ordinary-voice\.wav clip, starts/u }).press('Enter');
	await chooseCommandAction(page, editor, 'Window', 'Dialogue Chain');
	const dialog = page.getByRole('dialog', { name: 'Dialogue Chain', exact: true });
	await expect(dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Dialogue chain applied.');
});

async function expectRefusal(page, editor) {
	await chooseCommandAction(page, editor, 'Window', 'Dialogue Chain');
	const dialog = page.getByRole('dialog', { name: 'Dialogue Chain', exact: true });
	await expect(dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true })).toBeDisabled();
	await expect(dialog).toContainText('Select an audio track');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
