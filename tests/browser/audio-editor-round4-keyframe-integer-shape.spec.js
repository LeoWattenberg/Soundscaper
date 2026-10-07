/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('integer effect keyframes begin with the supported Hold interpolation', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('pixelate-keyframes.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Choose an effect', exact: true }).click();
	await page.getByRole('option', { name: 'Pixelate', exact: true }).click();
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	await expect(rack.getByRole('checkbox', { name: 'Pixelate', exact: true })).toBeChecked();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	const target = dialog.getByRole('combobox', { name: 'Target', exact: true });
	await target.selectOption({ label: 'Block size' });
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('32');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('combobox', { name: 'Anchor', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	expect(transfer.curve.anchors.map(anchor => anchor.value)).toEqual([16, 32]);
	expect(transfer.curve.segments).toEqual([{ kind: 'hold' }]);
	for (const interpolation of await dialog.getByRole('combobox', { name: 'Interpolation', exact: true }).all()) {
		await expect(interpolation.getByRole('option')).toHaveCount(1);
		await expect(interpolation).toHaveValue('hold');
	}
});
