/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('reopening a caption track preserves its authored name and language fields', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Track name', exact: true }).fill('French dialogue');
	await dialog.getByRole('textbox', { name: 'Language', exact: true }).fill('fr');
	await dialog.getByRole('textbox', { name: 'Sidecar text', exact: true })
		.fill('1\n00:00:00,000 --> 00:00:01,000\nBonjour\n');
	await dialog.getByRole('button', { name: 'Import sidecar text', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('No interchange losses.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	await expect(dialog.getByRole('textbox', { name: 'Track name', exact: true })).toHaveValue('French dialogue');
	await expect(dialog.getByRole('textbox', { name: 'Language', exact: true })).toHaveValue('fr');
	await dialog.getByRole('textbox', { name: 'Sidecar text', exact: true })
		.fill('1\n00:00:00,000 --> 00:00:01,000\nBonsoir\n');
	await dialog.getByRole('button', { name: 'Import sidecar text', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('No interchange losses.');
	const document = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
	expect(document).toMatchObject([{ name: 'French dialogue', language: 'fr' }]);
});
