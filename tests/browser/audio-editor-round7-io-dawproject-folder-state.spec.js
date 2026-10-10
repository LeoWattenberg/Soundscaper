/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { parseDawprojectDocument } from '../../src/common/editor/dawproject-import.ts';

for (const mute of [false, true]) test(`own DAWproject archive and Open preserve folder mute=${mute}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const recording = clipByName(editor, monoTone.name);
	const track = recording.locator('xpath=ancestor::div[@data-track-row][1]');
	await recording.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await expect(folder).toBeVisible();
	const muted = folder.getByRole('button', { name: 'Mute folder', exact: true });
	await expect(muted).toHaveAttribute('aria-pressed', 'false');
	if (mute) await muted.click();
	await expect(muted).toHaveAttribute('aria-pressed', String(mute));
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const entries = unzipSync(bytes);
	const decode = name => new TextDecoder().decode(entries[name]);
	const document = parseDawprojectDocument(decode('project.xml'), decode('metadata.xml'));
	expect(document.tracks.find(candidate => candidate.name === 'Folder 1')?.channel?.mute?.value).toBe(mute);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clipByName(editor, monoTone.name.replace(/\.wav$/u, '')))
		.toHaveAttribute('aria-label', 'browser-mono-tone clip, starts at 0 seconds, 0.8 seconds long');
	await expect(muted).toHaveAttribute('aria-pressed', String(mute));
});
