/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('macro programs read the header-selected range and apply relative selection time', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'const selected = await sound.project.selection();',
		"sound.log.info('Selection frames ' + selected.startFrame + '..' + selected.endFrame);",
		"const relative = await sound.select.time(0.2, 0, { relativeTo: 'selection-end' });",
		"sound.log.info('Relative selection frames ' + relative.startFrame + '..' + relative.endFrame);",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('Selection frames 0..38400');
	await expect(log).toContainText('Relative selection frames 28800..38400');
});
