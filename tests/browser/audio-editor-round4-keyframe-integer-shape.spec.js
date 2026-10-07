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

test('removing an interior integer keyframe preserves a supported Hold bridge', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('pixelate-removal.webm')]);
	const properties = await openClipProperties(page, editor, editor.getByRole('group', { name: /^Video clip:/u }).first());
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Choose an effect', exact: true }).click();
	await page.getByRole('option', { name: 'Pixelate', exact: true }).click();
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Block size' });
	await dialog.getByRole('combobox', { name: 'Interpolation', exact: true }).selectOption('hold');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('32');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	const anchor = dialog.getByRole('combobox', { name: 'Anchor', exact: true });
	await expect(anchor.getByRole('option')).toHaveCount(2);
	await dialog.getByRole('textbox', { name: 'Position (frames or num/den)', exact: true }).fill('12');
	await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('24');
	await dialog.getByRole('button', { name: 'Insert anchor', exact: true }).click();
	await expect(anchor.getByRole('option')).toHaveCount(3);
	await expect(dialog.getByRole('button', { name: 'Remove anchor', exact: true })).toBeEnabled();
	await anchor.focus();
	await anchor.press('ArrowDown');
	await expect(anchor).toHaveValue('1');
	await expect(dialog.getByRole('spinbutton', { name: 'Value', exact: true })).toHaveValue('24');
	await dialog.getByRole('button', { name: 'Remove anchor', exact: true }).click();
	await expect(anchor.getByRole('option')).toHaveCount(2);
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	expect(transfer.curve.anchors.map(item => item.value)).toEqual([16, 32]);
	expect(transfer.curve.segments).toEqual([{ kind: 'hold' }]);
});
