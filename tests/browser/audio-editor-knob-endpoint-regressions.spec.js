/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('mixer pan slider reaches either endpoint with Home and End', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const pan = editor.locator('.kw-audio-editor__mixer-channel--track').getByRole('slider', { name: /^Pan:/u });
	await pan.focus();
	await pan.press('Home');
	await expect(pan).toHaveAttribute('aria-valuenow', '-100');
	await pan.press('End');
	await expect(pan).toHaveAttribute('aria-valuenow', '100');
});
