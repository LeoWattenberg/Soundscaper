/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('a track-creation macro can run without an audio selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		manager.getByRole('button', { name: 'Import macro', exact: true }).click(),
	]);
	await chooser.setFiles({ name: 'new-tracks.txt', mimeType: 'text/plain', buffer: Buffer.from('NewMonoTrack:\nNewMonoTrack:\n') });
	const run = manager.getByRole('button', { name: 'Run macro', exact: true });
	await expect(run).toBeEnabled();
	await run.click();
	await expect(editor).toHaveAttribute('data-track-count', '3');
});
