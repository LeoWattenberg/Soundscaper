/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

let archive;
let originalId;
test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		originalId = await editor.getAttribute('data-project-id');
		const exporting = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		archive = await readFile(await (await exporting).path());
	} finally { await context.close(); }
});

test('opening an ordinary Soundscaper archive leaves the foreign video preview empty without a graph error', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'ordinary.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview.getByRole('status')).toBeVisible();
	await expect(preview.getByRole('alert')).toHaveCount(0);
});

test('an ordinary Framescaper image still renders in video preview', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-renderable-clip-count', '1');
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(preview.getByRole('alert')).toHaveCount(0);
});
