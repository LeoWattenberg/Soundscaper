/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
} from './audio-editor-test-helpers.js';

test('confirms a stereo paste into a mono track and can remember the decision', async ({ page }) => {
	test.setTimeout(60_000);
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);

	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	const firstProjectId = await editor.getAttribute('data-project-id');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(firstProjectId);
	await importFiles(editor, [monoTone]);
	await expect(clipByName(editor, monoTone.name)).toBeVisible();
	await editor.getByRole('button', {
		name: 'Rename track: browser-mono-tone', exact: true,
	}).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);

	const confirmation = page.getByRole('dialog', { name: 'Mix down to mono', exact: true });
	await expect(confirmation).toBeVisible();
	await expect(confirmation).toContainText(
		'This action requires one or more clips to be converted to mono. Would you like to proceed?',
	);
	await confirmation.getByRole('checkbox', { name: 'Don’t show again', exact: true }).check();
	await confirmation.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(confirmation).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(confirmation).toHaveCount(0);
	expect(clientErrors).toEqual([]);
});
