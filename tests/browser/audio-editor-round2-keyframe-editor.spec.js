/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

async function openScaleCurve(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('curve-editing.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	return dialog;
}

test('updating an existing keyframe anchor retains the selected anchor', async ({ page }) => {
	const dialog = await openScaleCurve(page);
	const anchor = dialog.getByRole('combobox', { name: 'Anchor', exact: true });
	await anchor.focus();
	await anchor.press('ArrowDown');
	await expect(anchor).toHaveValue('1');
	await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('1.5');
	await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
	await expect(anchor).toHaveValue('1');
	await expect(dialog.getByRole('spinbutton', { name: 'Value', exact: true })).toHaveValue('1.5');
});

test('switching a later keyframe segment to Bezier seeds controls within that segment', async ({ page }) => {
	const dialog = await openScaleCurve(page);
	await dialog.getByRole('textbox', { name: 'Position (frames or num/den)', exact: true }).fill('10');
	await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('1.1');
	await dialog.getByRole('button', { name: 'Insert anchor', exact: true }).click();
	const segment = dialog.getByRole('combobox', { name: 'Segment', exact: true });
	await segment.focus();
	await segment.press('ArrowDown');
	await expect(segment).toHaveValue('1');
	const interpolation = dialog.getByRole('group', { name: 'Edit curve', exact: true }).getByRole('combobox', { name: 'Interpolation', exact: true });
	await interpolation.selectOption('bezier');
	await dialog.getByRole('button', { name: 'Update segment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await expect(interpolation).toHaveValue('bezier');
});

test('copying a keyframe curve uses the curve selected in the editor', async ({ page }) => {
	const dialog = await openScaleCurve(page);
	const target = dialog.getByRole('combobox', { name: 'Target', exact: true });
	await target.selectOption({ label: 'Opacity' });
	await dialog.getByRole('spinbutton', { name: 'Start value', exact: true }).fill('0.5');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('0.8');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeEnabled();
	await target.selectOption({ label: 'Scale X' });
	const curve = dialog.getByRole('combobox', { name: 'Curve', exact: true });
	await curve.selectOption({ label: 'Opacity' });
	await expect(curve).toHaveValue(JSON.stringify(['composition', 'opacity']));
	for (const action of ['Copy curve', 'Prepare preset']) {
		await dialog.getByRole('button', { name: action, exact: true }).click();
		const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
		expect(transfer.curve.anchors.map(({ value }) => value)).toEqual([0.5, 0.8]);
	}
});
