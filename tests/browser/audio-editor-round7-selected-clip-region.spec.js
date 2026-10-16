/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('named region creation uses an ordinary header-selected recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	const createRegion = panel.getByRole('button', { name: 'Add region from selection', exact: true });
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await expect(createRegion).toBeEnabled();
	await createRegion.click();
	await expect(panel.locator('[data-timeline-annotation]')).toHaveCount(1);
	const healthyEnd = await panel.getByRole('group', { name: 'End sample', exact: true }).locator('.timecode__display').textContent();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(createRegion).toBeEnabled();
	await createRegion.click();
	await expect(panel.locator('[data-timeline-annotation]')).toHaveCount(1);
	const row = panel.locator('li').first();
	await expect(row.getByRole('combobox', { name: 'Kind', exact: true })).toHaveValue('region');
	await expect(row.getByRole('group', { name: 'End sample', exact: true }).locator('.timecode__display')).toHaveText(healthyEnd);
});
