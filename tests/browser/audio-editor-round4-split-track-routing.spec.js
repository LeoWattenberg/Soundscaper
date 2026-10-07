/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const mode of ['header', 'range']) test(`Split into new track retains outgoing routing for ${mode} selection`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
	const outputs = mixer.getByRole('combobox', { name: /^Output:/u });
	await outputs.nth(1).selectOption({ label: 'Group bus 1' });
	const assignment = await outputs.nth(1).inputValue();
	const sends = mixer.getByRole('slider', { name: /^Send level:/u });
	await sends.nth(1).press('End');
	for (let step = 0; step < 12; step += 1) await sends.nth(1).press('ArrowDown');
	await expect(sends.nth(1)).toHaveAttribute('aria-valuenow', '0');
	await clip.locator('.clip-header').click();
	if (mode === 'range') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	else await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('ArrowRight');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(outputs).toHaveCount(3);
	await expect(outputs.nth(2)).toHaveValue(assignment);
	await expect(sends.nth(2)).toHaveAttribute('aria-valuenow', '0');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(outputs).toHaveCount(2);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(outputs).toHaveCount(3);
	await expect(outputs.nth(2)).toHaveValue(assignment);
	await expect(sends.nth(2)).toHaveAttribute('aria-valuenow', '0');
});
