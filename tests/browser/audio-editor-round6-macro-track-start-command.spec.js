/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const command of ['SelTrackStartToCursor', 'SelCursorStoredCursor']) test(`the ${command} macro name retains its own selection meaning`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clickClipInterior(page, clip, .5);
	const cursor = Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'));
	expect(cursor).toBeGreaterThan(0);
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	const supported = command === 'SelTrackStartToCursor';
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill([
		`await sound.select.time(${cursor / 48_000}, ${cursor / 48_000});`,
		supported ? `await sound.command('${command}');` : [
			`try { await sound.command('${command}'); }`,
			"catch (error) { sound.log.info('stored cursor refused'); }",
		].join('\n'),
		'const selection = await sound.project.selection();',
		"sound.log.info('range ' + selection.startFrame + '-' + selection.endFrame);",
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = palette.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u);
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText(supported ? `range 0-${cursor}` : `range ${cursor}-${cursor}`);
	if (!supported) await expect(log).toContainText('stored cursor refused');
});
