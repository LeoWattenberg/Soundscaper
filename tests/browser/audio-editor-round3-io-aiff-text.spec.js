/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

const recording = Buffer.from(readFileSync(new URL('../fixtures/libsndfile-utf8-text.aiff.base64', import.meta.url), 'utf8').trim(), 'base64');

test('ordinary AIFF production text retains its accented title and artist', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'studio-notes.aiff', mimeType: 'audio/aiff', buffer: recording }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const title = attribution.locator('dl > div').filter({ has: page.getByText('normalized.title', { exact: true }) });
	const artist = attribution.locator('dl > div').filter({ has: page.getByText('normalized.artist', { exact: true }) });
	await expect(title.locator('dd')).toHaveText('Straße am Meer');
	await expect(artist.locator('dd')).toHaveText('Élodie');
});
