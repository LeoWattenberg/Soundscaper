/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('deleting a source stretch marker keeps keyboard playback on the source waveform', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	const bounds = await waveform.boundingBox();
	expect(bounds).not.toBeNull();
	await waveform.click({ position: { x: bounds.width / 2, y: bounds.height / 2 }, modifiers: ['Control'] });
	const marker = panel.getByRole('button', { name: 'Stretch marker 1', exact: true });
	await expect(marker).toBeVisible();
	await marker.focus();
	await page.keyboard.press('Delete');
	await expect(marker).toHaveCount(0);
	await expect(waveform).toBeFocused();
	await page.keyboard.press('Control+a');
	await expect(panel.locator('.audio-editor-source-selection')).toBeVisible();
});
