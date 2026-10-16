/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

test('an open spectral dialog blocks unavailable actions after a normal editing lease change', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await page.keyboard.press('ControlOrMeta+a');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	const amplify = dialog.getByRole('button', { name: 'Spectral Amplify', exact: true });
	const remove = dialog.getByRole('button', { name: 'Spectral Delete', exact: true });
	await expect(amplify).toBeEnabled();
	await expect(remove).toBeEnabled();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		await expect(amplify).toBeDisabled();
		await expect(remove).toBeDisabled();
		const select = dialog.getByRole('button', { name: 'Select range', exact: true });
		await expect(select).toBeDisabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	} finally {
		await other.close();
	}
});
