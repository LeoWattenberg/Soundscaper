/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, openClipProperties } from './audio-editor-test-helpers.js';

test('Rhythm Track retains all sixteen bars at thirty beats per minute', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Rhythm Track']);
	const dialog = page.getByRole('dialog', { name: 'Rhythm Track', exact: true });
	await dialog.getByRole('spinbutton', { name: /^Tempo \(bpm\)/u }).fill('30');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 60_000 });
	const clip = editor.locator('[data-clip-id]').first();
	await expect(clip).toBeVisible();
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.locator('[data-clip-field="durationFrame"] .timecode__display'))
		.toHaveText('00h02m08.000s');
});
