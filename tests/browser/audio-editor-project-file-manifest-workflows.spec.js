import { Buffer } from 'node:buffer';

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseExportProjectFileAction,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

test.describe('project archive and checksum files', () => {
	registerAudioEditorHooks();

	test('exports, saves checksums, reopens an uppercase suffix and downloads an editable copy', async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		const originalProjectId = await editor.getAttribute('data-project-id');

		const archiveDownloadPromise = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const archiveDownload = await archiveDownloadPromise;
		expect(archiveDownload.suggestedFilename()).toMatch(/\.sscape$/u);
		const archive = await downloadBytes(archiveDownload);
		expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		await archiveDownload.delete();

		const checksumDownloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', [
			'Project management',
			'Save archive checksums',
		]);
		const checksumDownload = await checksumDownloadPromise;
		expect(checksumDownload.suggestedFilename()).toMatch(/archive-manifest.*\.json$/u);
		const checksumManifest = JSON.parse(new TextDecoder().decode(await downloadBytes(checksumDownload)));
		expect(checksumManifest).toMatchObject({
			kind: 'archive-manifest',
			manifestVersion: 1,
		});
		expect(checksumManifest.members.map(({ id }) => id)).toEqual(expect.arrayContaining([
			'manifest.json',
			'project.json',
		]));
		expect(checksumManifest.totalByteLength).toBeGreaterThan(toneA.buffer.byteLength);
		await checksumDownload.delete();

		const chooserPromise = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooserPromise).setFiles({
			name: 'ARCHIVE-ROUNDTRIP.SSCAPE',
			mimeType: SCAPE_MIME_TYPE,
			buffer: Buffer.from(archive),
		});
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible({ timeout: 20_000 });
		await collision.getByRole('button', { name: /^Open as (?:read-only )?copy$/u }).click();
		await expect.poll(() => editor.getAttribute('data-project-id'), { timeout: 20_000 })
			.not.toBe(originalProjectId);
		await expect(clipByName(editor, toneA.name)).toBeVisible();

		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await chooseFileAction(page, editor, 'Edit in Framescaper');
		await expect(page).toHaveURL((url) => url.pathname === '/transfer/send/' && url.searchParams.has('handoff'));
		await expect(page.locator('input[data-transfer-choice]:checked')).toHaveCount(1);
		const editableCopyDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Download the ticked archives', exact: true }).click();
		const editableCopyDownload = await editableCopyDownloadPromise;
		expect(editableCopyDownload.suggestedFilename()).toMatch(/\.fscape$/u);
		expect((await downloadBytes(editableCopyDownload)).byteLength).toBeGreaterThan(0);
		await expect(page.getByText(
			'Downloaded 1 of 1 projects. Nothing on this origin was changed.',
			{ exact: true },
		)).toBeVisible({ timeout: 20_000 });
		expect(errors).toEqual([]);
	});
});
