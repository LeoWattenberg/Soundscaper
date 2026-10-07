/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Make stereo retains the common bus output of its two mono recordings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, { ...monoTone, name: 'right-channel.wav' }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	const outputs = mixer.getByRole('combobox', { name: /^Output:/u });
	await outputs.nth(1).selectOption({ label: 'Group bus 1' });
	await outputs.nth(2).selectOption({ label: 'Group bus 1' });
	const bus = await outputs.nth(1).inputValue();
	const track = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(outputs).toHaveCount(2);
	await expect(outputs.nth(1)).toHaveValue(bus);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(outputs).toHaveCount(3);
	await expect(outputs.nth(1)).toHaveValue(bus);
	await expect(outputs.nth(2)).toHaveValue(bus);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(outputs).toHaveCount(2);
	await expect(outputs.nth(1)).toHaveValue(bus);
});
