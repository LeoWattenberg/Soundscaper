/* SPDX-License-Identifier: AGPL-3.0-only */

import { chooseClipMediaSetting, expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('the clip resample field keeps its native composition until the completed Enter', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));

	await chooseClipMediaSetting(properties, 'Resample');
	const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
	const rate = dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u });
	await rate.fill('24000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24000);
	const resampledName = `${toneA.name} (24000 Hz)`;
	await expect(clipByName(editor, resampledName)).toBeVisible();
	await chooseClipMediaSetting(properties, 'Resample');
	await rate.fill('32000');
	const prevented = await rate.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(dialog).toBeVisible();
	await expect(rate).toBeFocused();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24000);
	await chooseClipMediaSetting(properties, 'Resample');
	await rate.fill('48000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 48000);
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, clipByName(editor, resampledName));
	await expectClipSampleRate(restored, 24000);
});
