/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, importFiles, resolveBrowserProductTestUrl, waitForEditor,
} from './audio-editor-test-helpers.js';

for (const raw of [true, false]) {
	test(`the open ${raw ? 'raw PCM import' : 'regular interval labels'} dialog follows a real editing lease change`, async ({ page, context }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const title = raw ? 'Import raw data' : 'Regular interval labels';
		await chooseCommandAction(page, editor, 'Tools', title);
		const dialog = page.getByRole('dialog', { name: title, exact: true });
		if (raw) await dialog.getByLabel('Raw PCM file').setInputFiles({
			name: 'ordinary-short-tone.raw', mimeType: 'application/octet-stream', buffer: toneA.buffer.subarray(44, 236),
		});
		const submit = dialog.getByRole('button', { name: raw ? 'Import' : 'Create annotations', exact: true });
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
