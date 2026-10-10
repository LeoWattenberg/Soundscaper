/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

const camera = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');

for (const sequenceRate of [25, 30]) test(`FCPXML declares the unchanged 25 fps camera inside a ${sequenceRate} fps sequence`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption(`${sequenceRate}/1`);
	await closeWorkspacePanel(editor, 'metadata');
	await importFiles(editor, [camera.file]);
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(1);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export FCPXML']);
	const download = await downloading;
	let text;
	try { text = Buffer.from(await downloadBytes(download)).toString('utf8'); } finally { await download.delete(); }
	const sourceFormat = text.match(/<asset\b[^>]*\bformat="([^"]+)"/u)?.[1];
	expect(sourceFormat).toBeTruthy();
	const formats = [...text.matchAll(/<format\b[^>]*id="([^"]+)"[^>]*frameDuration="([^"]+)"/gu)];
	expect(formats.find(match => match[1] === sourceFormat)?.[2]).toBe('1/25s');
	expect(formats.find(match => match[1] === 'r1')?.[2]).toBe(`1/${sequenceRate}s`);
	expect(text).toContain('<sequence format="r1"');
});
