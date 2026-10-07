/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Remove tracks removes every explicitly selected audio track in one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	await chooseNestedCommandAction(page, editor, 'Select', ['Select none']);
	await first.locator('xpath=ancestor::div[@data-track-row]').locator('.track-control-panel__track-name-text').click();
	await second.locator('xpath=ancestor::div[@data-track-row]').locator('.track-control-panel__track-name-text').click({ modifiers: ['ControlOrMeta'] });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await expect(first).toHaveCount(0);
	await expect(second).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(first).toBeVisible();
	await expect(second).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(first).toHaveCount(0);
	await expect(second).toHaveCount(0);
});
