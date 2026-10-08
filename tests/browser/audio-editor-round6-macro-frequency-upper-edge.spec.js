/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a program can author its first spectral lower bound while retaining the upper bandwidth', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'await sound.select.frequencies({low:500});',
		'sound.log.info(JSON.stringify(await sound.project.selection()));',
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = palette.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u);
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('"minimumFrequency":500');
	await expect(log).toContainText('"maximumFrequency":24000');
});
