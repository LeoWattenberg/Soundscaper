/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('splitting a routed stereo track retains its bus assignment and send levels', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
	const outputs = mixer.getByRole('combobox', { name: /^Output:/u });
	const output = outputs.nth(1);
	await output.selectOption({ label: 'Group bus 1' });
	const bus = await output.inputValue();
	const sends = mixer.getByRole('slider', { name: /^Send level:/u });
	const send = sends.nth(1);
	await send.press('End');
	for (let step = 0; step < 12; step += 1) await send.press('ArrowDown');
	await expect(send).toHaveAttribute('aria-valuenow', '0');
	await chooseTrackMenuAction(page, editor, clip.locator('xpath=ancestor::div[@data-track-row][1]'),
		['Track channels', 'Split stereo to left/right mono']);
	await expect(outputs).toHaveCount(3);
	for (const index of [1, 2]) {
		await expect(outputs.nth(index)).toHaveValue(bus);
		await expect(sends.nth(index)).toHaveAttribute('aria-valuenow', '0');
	}
});
