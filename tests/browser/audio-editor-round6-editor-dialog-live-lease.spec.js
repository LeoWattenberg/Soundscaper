/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles, resolveBrowserProductTestUrl, waitForEditor,
} from './audio-editor-test-helpers.js';

for (const raw of [true, false]) {
	test(`the open ${raw ? 'project rename' : 'track resample'} dialog follows a real editing lease change`, async ({ page, context }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const title = raw ? 'Rename project' : 'Resample';
		if (raw) await chooseNestedCommandAction(page, editor, 'File', ['Project management', title]);
		else {
			await clipByName(editor, monoTone.name).locator('xpath=ancestor::*[@data-track-row][1]').locator('[data-track-header]').click();
			await chooseCommandAction(page, editor, 'Tracks', title);
		}
		const dialog = page.getByRole('dialog', { name: title, exact: true });
		await dialog.getByRole('textbox').fill(raw ? 'Second recording' : '24000');
		const submit = dialog.getByRole('button', { name: raw ? 'Save name' : 'Resample', exact: true });
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
}
