/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles, openNestedCommandMenu,
} from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('FCPXML reports a normally imported image it cannot deliver', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('camera.webm')]);
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const downloading = page.waitForEvent('download');
	const exportMenu = await openNestedCommandMenu(page, editor, 'File', ['Export other']);
	await exportMenu.getByRole('menuitem', { name: 'Export FCPXML', exact: true }).click();
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toBeVisible();
	const text = new TextDecoder().decode(await downloadBytes(await downloading));
	expect(text).toContain('<fcpxml');
	expect(text).toContain('name="camera"');
	expect(text).not.toContain('name="poster"');
	await expect(report.locator('[data-severity="warning"]')).toContainText(/image/iu);
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
});
