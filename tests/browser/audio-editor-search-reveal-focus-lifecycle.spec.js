/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('revealing an audio clip through Search does not steal focus from later keyboard volume edits', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await page.keyboard.press('Control+k');
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await expect(search).toBeFocused();
	await search.fill(monoTone.name);
	const result = editor.getByRole('group', { name: 'Timeline clips', exact: true })
		.getByRole('option').filter({ hasText: monoTone.name });
	await expect(result).toHaveCount(1);
	await result.click();
	await expect(clip).toBeFocused();
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const row = editor.locator('[data-track-row]').filter({ has: clipByName(page, monoTone.name) });
	await expect(row).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const bounds = await volume.boundingBox();
	expect(bounds).not.toBeNull();
	const minimum = Number(await volume.getAttribute('min') ?? 0);
	const maximum = Number(await volume.getAttribute('max') ?? 100);
	const fraction = (Number(await volume.inputValue()) - minimum) / (maximum - minimum);
	await volume.click({ position: { x: 7 + (bounds.width - 14) * fraction, y: bounds.height / 2 } });
	await expect(volume).toBeFocused();
	const initial = Number(await volume.inputValue());
	for (const decrement of [1, 2]) {
		await page.keyboard.press('ArrowDown');
		await expect(volume).toHaveValue(String(initial - decrement));
		await expect(editor.getByText('All changes saved locally', { exact: true })).toBeVisible();
		await expect(volume).toBeFocused();
	}
});
