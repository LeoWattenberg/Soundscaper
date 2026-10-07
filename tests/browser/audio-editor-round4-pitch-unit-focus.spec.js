/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('changing clip pitch units retains the selected unit button for keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Pitch and tempo', { exact: true }).click();
	const percent = panel.getByRole('button', { name: 'Percent change', exact: true });
	await percent.focus();
	await percent.press('Enter');
	await expect(percent).toHaveAttribute('aria-pressed', 'true');
	await expect(percent).toBeFocused();
	await percent.press('Shift+Tab');
	const semitones = panel.getByRole('button', { name: 'Semitones (half-steps)', exact: true });
	await expect(semitones).toBeFocused();
	await semitones.press('Enter');
	await expect(semitones).toHaveAttribute('aria-pressed', 'true');
	await expect(semitones).toBeFocused();
});
