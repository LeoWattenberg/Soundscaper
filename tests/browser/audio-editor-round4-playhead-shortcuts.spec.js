/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Ctrl+End on Playhead focuses the last track without seeking', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	const firstHeader = editor.locator('[data-track-header]').filter({ has: page.getByRole('group', { name: 'browser-tone-a track controls', exact: true }) });
	const lastHeader = editor.locator('[data-track-header]').filter({ has: page.getByRole('group', { name: 'browser-tone-b track controls', exact: true }) });
	await expect(firstHeader).toHaveAttribute('data-selected', 'true');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Shift+ArrowRight');
	await expect(playhead).toHaveAttribute('aria-valuenow', '4800');
	await playhead.press('ControlOrMeta+End');
	await expect(lastHeader).toHaveAttribute('data-selected', 'true');
	await expect(firstHeader).toHaveAttribute('data-selected', 'false');
	await expect(playhead).toHaveAttribute('aria-valuenow', '4800');
});
