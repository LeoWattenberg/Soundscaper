/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

test('Ctrl arrows move a clip to successive grid positions when Snap is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const initial = await clip.boundingBox(); expect(initial).not.toBeNull();
	await clip.focus();
	await clip.press('Control+ArrowRight');
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeGreaterThan(initial.x);
	const right = await clip.boundingBox(); expect(right).not.toBeNull();
	await clip.press('Control+ArrowRight');
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeGreaterThan(right.x);
	await clip.press('Control+ArrowLeft');
	await expect.poll(async () => (await clip.boundingBox())?.x).toBe(right.x);
});
