/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, chooseNestedCommandAction,
	closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';

const cameraMedia = [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1'),
	videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1')];

for (const [mode, grouped] of [['duplicate', false], ['duplicate', true], ['archive copy', true]]) {
	test(`${mode} ${grouped ? 'retains an authored multicamera group' : 'retains the ordinary camera control'}`, async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
		await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
		await closeWorkspacePanel(editor, 'metadata');
		for (const [index, media] of cameraMedia.entries()) {
			await importFiles(editor, [{ name: `camera-${index}.mp4`, mimeType: media.file.mimeType, buffer: Buffer.from(media.file.buffer) }]);
		}
		const originalId = await editor.getAttribute('data-project-id');
		const clips = editor.getByRole('group', { name: /^Video clip:/u });
		await expect(clips).toHaveCount(2);
		if (grouped) {
			await clips.first().focus();
			await clips.first().press('Enter');
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		if (mode === 'duplicate') await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
		else {
			const downloading = page.waitForEvent('download');
			await chooseExportProjectFileAction(page, editor);
			const download = await downloading;
			const archive = await downloadBytes(download);
			const opening = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Open');
			await (await opening).setFiles({ name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip',
				buffer: Buffer.from(archive) });
			await page.getByRole('dialog', { name: 'Project already exists', exact: true })
				.getByRole('button', { name: 'Open as copy', exact: true }).click();
		}
		await expect(editor).not.toHaveAttribute('data-project-id', originalId);
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		await expect(clips).toHaveCount(2);
		if (grouped) {
			await clips.first().focus();
			await clips.first().press('Enter');
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const copyId = await editor.getAttribute('data-project-id');
		const reopened = await bootEditor(page, `/framescaper/en/?project=${encodeURIComponent(copyId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', copyId);
		await expect(reopened.getByRole('group', { name: /^Video clip:/u })).toHaveCount(2);
	});
}
