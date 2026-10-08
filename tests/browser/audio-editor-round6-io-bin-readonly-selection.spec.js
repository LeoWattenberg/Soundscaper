/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, clipByName, resolveBrowserProductTestUrl, waitForEditor,
} from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Project bin can select its existing instances after another normal tab takes the editing lease', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([monoTone]);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const place = card.getByRole('button', { name: /^Add to timeline:/u });
	await place.click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await place.click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const displays = clipByName(editor, monoTone.name).locator('.clip-display');
	await expect(displays.nth(0)).toHaveAttribute('data-selected', 'false');
	await expect(displays.nth(1)).toHaveAttribute('data-selected', 'false');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const before = await persistedProject(page, projectId);
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(place).toBeDisabled();
		await page.bringToFront();
		const selection = card.getByRole('button', { name: /^Select all instances:/u });
		await expect(selection).toBeEnabled();
		await selection.click();
		await expect(displays.nth(0)).toHaveAttribute('data-selected', 'true');
		await expect(displays.nth(1)).toHaveAttribute('data-selected', 'true');
		await expect(place).toBeDisabled();
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		expect(await persistedProject(page, projectId)).toEqual(before);
	} finally {
		await other.close();
	}
});
