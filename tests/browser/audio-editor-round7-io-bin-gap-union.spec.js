/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, clipField, closeClipProperties, openClipProperties } from './audio-editor-test-helpers.js';

test('shorter bin replacement contracts coincident tails once', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	for (let count = 1; count <= 3; count += 1) {
		await card.getByRole('button', { name: /Add to timeline/u }).click();
		await expect(editor).toHaveAttribute('data-clip-count', String(count));
	}
	const laterClip = clipByName(editor, toneA.name).nth(2);
	const laterId = await laterClip.getAttribute('data-clip-id');
	const before = await openClipProperties(page, editor, laterClip);
	await before.getByText('Media settings', { exact: true }).click();
	await clipField(before, 'startFrame').fill('60000');
	await clipField(before, 'startFrame').press('Tab');
	await closeClipProperties(before);
	await card.getByRole('button', { name: /More file actions/u }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await chooser).setFiles(createWavFixture({ name: 'Short.wav', duration: 0.4, frequency: 550 }));
	const choice = page.locator('[data-project-bin-replacement-dialog]');
	await expect(choice).toBeVisible();
	await choice.getByRole('button', { name: 'Contract gaps', exact: true }).click();
	await expect(choice).toBeHidden();
	const later = await openClipProperties(page, editor, editor.locator(`[data-clip-id="${laterId}"][role="group"]`));
	await later.getByText('Media settings', { exact: true }).click();
	await expect(clipField(later, 'startFrame')).toHaveValue('40800');
	await expect(clipField(later, 'durationFrame')).toHaveValue('19200');
	await closeClipProperties(later);
});
