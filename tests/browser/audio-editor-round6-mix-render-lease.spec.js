/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, importFiles, resolveBrowserProductTestUrl, waitForEditor,
} from './audio-editor-test-helpers.js';

test('an open Mix and Render dialog respects a normally acquired read-only editing lease', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	const submit = dialog.getByRole('button', { name: 'Mix & Render', exact: true });
	await expect(submit).toBeEnabled();
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		await expect(dialog).toBeVisible();
		await expect(submit).toBeDisabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	} finally {
		await other.close();
	}
});
