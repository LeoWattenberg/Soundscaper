/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('a cancelled effect options trigger press does not swallow its next keyboard activation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const reverb = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const more = reverb.getByRole('button', { name: 'More options', exact: true });
	await more.click();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	const bounds = await more.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await expect(menu).toBeHidden();
	await page.mouse.move(bounds.x - 40, bounds.y + bounds.height / 2);
	await page.mouse.up();
	await more.press('Enter');
	await expect(menu).toBeVisible();
});
