/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a program can author its first spectral lower bound while retaining the upper bandwidth', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
	const track = editor.locator('[data-track-row]').first();
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
	await display.focus(); await page.keyboard.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	const clip = editor.locator('[data-clip-id]').first();
	await clip.focus();
	await clip.press('Control+a');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'await sound.select.frequencies({low:500});',
		"sound.log.info('selected the lower spectral edge');",
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = palette.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u);
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('selected the lower spectral edge');
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const spectral = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(spectral.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u })).toHaveValue('500');
	await expect(spectral.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u })).toHaveValue('24000');
});
