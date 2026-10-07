/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('macro Select all includes a label later than the final recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await importFiles(editor, [{ name: 'cue-labels.txt', mimeType: 'text/plain',
		buffer: Buffer.from('2\t2\tEnd cue\n') }]);
	await expect(editor.getByRole('group', { name: 'Edit labels: End cue', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'const selected = await sound.select.all();',
		"sound.log.info('All content ends at ' + selected.endFrame);",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('All content ends at 96000');
});
