/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, disableNativeSavePicker,
	downloadBytes, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';

test('Attribution credits the actual switched multicamera source for its ordinary output clip', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const media = [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1'),
		videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1')];
	for (const [index, file] of media.entries()) await importFiles(editor, [{
		name: `camera-${index ? 'b' : 'a'}.mp4`, mimeType: file.file.mimeType, buffer: Buffer.from(file.file.buffer),
	}]);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	await metadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const output = metadata.locator('.kw-audio-editor__attribution-occurrence')
		.filter({ has: page.getByRole('heading', { name: 'camera-a', exact: true }) });
	await expect(output.locator('strong')).toHaveText('camera-a.mp4');
	await closeWorkspacePanel(editor, 'metadata');
	const clip = editor.getByRole('group', { name: 'Video clip: camera-a', exact: true });
	await clip.focus(); await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	await metadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
	await expect(output.locator('strong')).toHaveText('camera-b.mp4');
	const downloading = page.waitForEvent('download');
	await metadata.getByRole('button', { name: 'Export CSV', exact: true }).click();
	const csv = new TextDecoder().decode(await downloadBytes(await downloading));
	const row = csv.split('\r\n').find((line) => line.includes(',"camera-a","00:00:'));
	expect(row).toContain(',"camera-b.mp4","video",');
	await page.reload();
	await waitForEditor(page);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	await metadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
	await expect(output.locator('strong')).toHaveText('camera-b.mp4');
});
