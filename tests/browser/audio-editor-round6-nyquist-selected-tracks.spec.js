/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clickClipInterior, clipByName,
	importFiles } from './audio-editor-test-helpers.js';

test('Nyquist counts one selected track for its two selected recording clips', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, monoTone.name), 0.5);
	await split.click();
	const clips = clipByName(editor, monoTone.name);
	await expect(clips).toHaveCount(2);
	await clips.nth(0).locator('.clip-header').click();
	await clips.nth(1).locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const prompt = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await prompt.getByRole('textbox', { name: 'Nyquist source', exact: true })
		.fill('(format nil "selected-tracks=~a" (length (get \'*selection* \'tracks)))');
	await prompt.getByRole('button', { name: 'Run', exact: true }).click();
	const output = prompt.locator('.kw-audio-editor__nyquist-output');
	await expect(output).toContainText('selected-tracks=1', { timeout: 20_000 });
	await expect(output).not.toContainText('selected-tracks=2');
});
