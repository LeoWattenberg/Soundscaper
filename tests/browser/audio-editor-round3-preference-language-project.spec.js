/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

test('changing the interface language keeps the current project when startup requests a new project', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'language-project.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.locator('[data-program-start-option="new-project"] input').check();
	await expect(preferences.locator('[data-program-start]')).toHaveAttribute('data-program-start', 'new-project');
	await preferences.getByRole('group', { name: 'Language', exact: true }).getByRole('button').click();
	await page.getByRole('option', { name: 'Deutsch', exact: true }).click();
	await page.waitForURL('**/embed/de/');
	const localized = await waitForEditor(page);
	await expect(localized).toHaveAttribute('data-project-id', projectId);
	await expect(localized).toHaveAttribute('data-clip-count', '1');
	await expect(localized.getByRole('group', { name: /language-project\.wav/u })).toHaveCount(1);
});
