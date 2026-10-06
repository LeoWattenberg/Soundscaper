/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('deleting the last EQ curve point transfers keyboard editing to the previous point', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Filter Curve EQ']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
	await commitInput(dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true }), '100:0, 1000:0');
	const graph = dialog.getByRole('group', { name: 'Equalization curve', exact: true });
	await expect(graph.getByRole('button')).toHaveCount(2);
	await graph.getByRole('button').last().focus();
	await page.keyboard.press('Delete');
	await expect(graph.getByRole('button')).toHaveCount(1);
	await expect(graph.getByRole('button')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(graph.getByRole('button')).toHaveAttribute('aria-label', /0\.1 dB$/u);
});
