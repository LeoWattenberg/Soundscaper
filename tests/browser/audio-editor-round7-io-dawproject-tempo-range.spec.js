/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker,
	downloadBytes, importFiles } from './audio-editor-test-helpers.js';

for (const bpm of [999, 1_000]) test(`native DAWproject download and Open retain ordinary authored ${bpm} BPM`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [monoTone]);
	const tempo = editor.locator('[data-action-id="playback-bpm"] input');
	await expect(tempo).toHaveAttribute('max', '1000');
	await tempo.fill(String(bpm));
	await tempo.press('Enter');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await expect(musical.getByRole('form', { name: 'Tempo event 1', exact: true }).locator('[name="bpmNum"]')).toHaveValue(String(bpm));
	await page.keyboard.press('Escape');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	const fileName = download.suggestedFilename();
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const projectXml = new TextDecoder().decode(unzipSync(bytes)['project.xml']);
	expect(projectXml).toMatch(new RegExp(`<Tempo[^>]*value="${bpm}"`, 'u'));
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: fileName, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(tempo).toHaveValue(String(bpm));
	const advertisedMaximum = Number(projectXml.match(/<Tempo[^>]*max="([^"]+)"/u)?.[1]);
	expect(advertisedMaximum).toBeGreaterThanOrEqual(bpm);
});
