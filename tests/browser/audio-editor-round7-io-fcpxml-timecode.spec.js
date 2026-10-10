/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, unlink } from 'node:fs/promises';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

test('FCPXML download keeps imported audio at the authored one-hour sequence origin', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [toneA]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const timing = panel.getByRole('tabpanel', { name: 'Sequence timing', exact: true });
	await timing.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	const start = timing.getByRole('textbox', { name: 'Start timecode', exact: true });
	await start.fill('01:00:00:00');
	await start.blur();
	await expect(timing.locator('[data-sequence-start-timecode]')).toHaveAttribute('data-sequence-start-timecode', '01:00:00:00');
	const downloaded = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export FCPXML']);
	const download = await downloaded;
	const path = await download.path();
	expect(path).not.toBeNull();
	let text;
	try { text = await readFile(path, 'utf8'); } finally { await unlink(path); }
	expect(text).toMatch(/tcStart="3600s"/u);
	expect(text).toMatch(/<asset-clip[^>]*offset="3600s"[^>]*start="0s"[^>]*duration="4\/5s"/u);
	expect(text).toMatch(/<sequence[^>]*duration="4\/5s"/u);
});
