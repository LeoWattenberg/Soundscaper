/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const history of ['fresh', 'timing-undo', 'saved-timing-undo']) test(`Add Images publishes after ${history}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	if (history !== 'fresh') {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
		const rate = metadata.getByRole('combobox', { name: 'Frame rate', exact: true });
		await rate.selectOption('25/1');
		await expect(rate).toHaveValue('25/1');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(rate).toHaveValue('30/1');
		if (history === 'saved-timing-undo') await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	}
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
});
