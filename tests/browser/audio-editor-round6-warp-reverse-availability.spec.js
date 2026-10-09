/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Media settings offers Reverse only when the authored clip supports it', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	const original = await openClipProperties(page, editor, clip);
	await original.getByText('Media settings', { exact: true }).click();
	const ordinaryReverse = original.getByRole('checkbox', { name: 'Reverse', exact: true });
	await expect(ordinaryReverse).toBeEnabled();
	await ordinaryReverse.check();
	await expect(ordinaryReverse).toBeChecked();
	await ordinaryReverse.uncheck();
	await expect(ordinaryReverse).not.toBeChecked();
	await closeClipProperties(original);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(warp).toContainText('Identity warp map created.');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.getByRole('checkbox', { name: 'Reverse', exact: true })).toBeDisabled();
	await properties.getByRole('checkbox', { name: 'Invert', exact: true }).check();
	await expect(properties.getByRole('checkbox', { name: 'Invert', exact: true })).toBeChecked();
	await closeClipProperties(properties);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const recovered = await openClipProperties(page, editor, clip);
	await recovered.getByText('Media settings', { exact: true }).click();
	const reverse = recovered.getByRole('checkbox', { name: 'Reverse', exact: true });
	await expect(reverse).toBeEnabled();
	await reverse.check();
	await expect(reverse).toBeChecked();
	await closeClipProperties(recovered);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await openClipProperties(page, editor, clip);
	await redone.getByText('Media settings', { exact: true }).click();
	await expect(redone.getByRole('checkbox', { name: 'Reverse', exact: true })).toBeChecked();
});
